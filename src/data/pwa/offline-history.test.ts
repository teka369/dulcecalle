import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { getPwaAuthSession } from "@/data/http/session";
import { mapPool, warmCashHistory, warmLedgerHistory, warmSalesHistory, HISTORY_FETCH_LIMIT } from "./offline-history";
import { PREP_VERSION, checkReadiness } from "./offline-prep";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SALE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CUSTOMER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const api = {
  sales: { list: vi.fn(async () => [] as unknown[]), returns: vi.fn(async () => [] as unknown[]) },
  customers: { ledger: vi.fn() },
  cash: {
    today: vi.fn(async () => ({ moves: [], session: null, localDate: "2026-10-04", expected: { efectivo: 0, nequi: 0, total: 0 }, closed: false })),
    expenses: vi.fn(async () => [] as unknown[]),
    moves: vi.fn(async () => []),
  },
  inventory: { moves: vi.fn(async () => []) },
  production: { list: vi.fn(async () => []) },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));

describe("offline history v1", () => {
  beforeEach(async () => {
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    getPwaAuthSession().businessId = BIZ;
  });

  it("limits concurrent history requests", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapPool(items, HISTORY_FETCH_LIMIT, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
    expect(peak).toBeLessThanOrEqual(HISTORY_FETCH_LIMIT);
    expect(peak).toBeGreaterThan(1);
  });

  it("persists a sale with lines and returns without duplicating on repeat", async () => {
    api.sales.list.mockResolvedValue([
      {
        id: SALE,
        customerId: CUSTOMER,
        paymentKind: "credit",
        method: null,
        saleTotal: 500,
        amountReceived: 0,
        credit: 500,
        note: null,
        occurredOn: "2026-10-01",
        createdAt: Date.now(),
        lines: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", productId: PRODUCT, productName: "Gomitas", qty: 1, unitPrice: 500, unitCost: 100, lineTotal: 500 }],
      },
    ]);
    api.sales.returns.mockResolvedValue([
      { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", saleId: SALE, refundAmount: 0, debtReduced: 100, method: null, note: null, occurredOn: "2026-10-02", createdAt: Date.now(), lines: [] },
    ]);
    await warmSalesHistory(BIZ);
    await warmSalesHistory(BIZ);
    expect(await getLocalDb().sales.where("businessId").equals(BIZ).count()).toBe(1);
    expect(await getLocalDb().saleLines.where("businessId").equals(BIZ).count()).toBe(1);
    expect(await getLocalDb().saleReturns.where("businessId").equals(BIZ).count()).toBe(1);
    expect(await getLocalDb().cacheMeta.get(`${BIZ}::history:sales`)).toBeTruthy();
  });

  it("keeps a pending abono when the ledger is prepared again", async () => {
    const now = Date.now();
    await getLocalDb().customers.put({
      id: CUSTOMER, businessId: BIZ, code: null, name: "Rosa", phone: null, debt: 15000,
      archivedAt: null, createdAt: now, updatedAt: now,
    });
    await getLocalDb().customerPayments.put({
      id: "99999999-9999-4999-8999-999999999999",
      businessId: BIZ, customerId: CUSTOMER, amount: 5000, method: "Efectivo",
      saleId: null, requestId: "pay-1", note: null, occurredOn: "2026-10-04", createdAt: now,
    });
    await getLocalDb().outbox.put({
      operationId: "99999999-9999-4999-8999-999999999999",
      businessId: BIZ, entity: "customerPayment", operation: "pay", requestId: "pay-1",
      payload: { customerId: CUSTOMER, amount: 5000 }, dependsOn: [], localCreatedAt: now,
      status: "pending", remoteId: null, attempts: 0, lastError: null, nextAttemptAt: null,
    });
    api.customers.ledger.mockResolvedValue({
      customer: { id: CUSTOMER, code: "1", name: "Rosa", phone: null, debt: 20000, archivedAt: null, createdAt: now },
      initials: [],
      sales: [],
      payments: [],
    });
    await warmLedgerHistory(BIZ);
    const customer = await getLocalDb().customers.get(CUSTOMER);
    expect(customer?.debt).toBe(15000);
    expect(await getLocalDb().customerPayments.get("99999999-9999-4999-8999-999999999999")).toBeTruthy();
  });

  it("does not mix another business into cash history", async () => {
    api.cash.expenses.mockResolvedValue([
      { id: "12121212-1212-4121-8121-121212121212", amount: 1000, category: "Hielo", method: "Efectivo", note: null, occurredOn: "2026-10-03", createdAt: Date.now() },
    ]);
    await warmCashHistory(BIZ);
    expect(await getLocalDb().expenses.where("businessId").equals(BIZ).count()).toBe(1);
    expect(await getLocalDb().expenses.where("businessId").equals(OTHER).count()).toBe(0);
    expect(await getLocalDb().cacheMeta.get(`${OTHER}::history:cash`)).toBeUndefined();
  });

  it("is not ready when a history dataset is missing", async () => {
    const row = {
      id: `readiness::${BIZ}`, businessId: BIZ, status: "ready" as const,
      prepVersion: PREP_VERSION, dbVersion: getLocalDb().verno, completedAt: Date.now(), tasks: [],
    };
    await getLocalDb().prepState.put(row);
    expect((await checkReadiness(BIZ)).status).not.toBe("ready");
  });
});
