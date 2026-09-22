import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { newEntityId } from "@/data/local/ids";
import { getStatementWithOfflineFallback } from "./offline-statement";
import { listLocalSurtidas } from "./offline-operations";

const BIZ = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SUPPLIER_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";

const api = {
  session: { businessId: BIZ },
  customers: { ledger: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

async function seedCustomer(debt = 4000) {
  const now = Date.now();
  await getLocalDb().customers.put({
    id: CUSTOMER_ID,
    businessId: BIZ,
    code: "DC-0001",
    name: "Rosa",
    phone: null,
    debt,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

describe("offline readers: statement and surtidas", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = BIZ;
  });

  it("builds the statement from local rows when the ledger is unreachable", async () => {
    await seedCustomer(4000);
    const now = Date.now();
    await getLocalDb().customerPayments.put({
      id: newEntityId(),
      businessId: BIZ,
      customerId: CUSTOMER_ID,
      amount: 1000,
      method: "Efectivo",
      saleId: null,
      requestId: newEntityId(),
      note: "abono",
      occurredOn: "2026-09-20",
      createdAt: now,
    });
    api.customers.ledger.mockRejectedValue(new NetworkError("offline"));
    const result = await getStatementWithOfflineFallback(CUSTOMER_ID);
    expect(result?.source).toBe("cache");
    expect(result?.statement.total).toBe(4000);
    expect(result?.statement.customerName).toBe("Rosa");
    const abono = result?.statement.entries.find((e) => e.kind === "abono");
    expect(abono).toMatchObject({ amount: 1000, note: "abono" });
  });

  it("rethrows server errors instead of inventing a statement", async () => {
    await seedCustomer();
    const serverError = new ApiError("INTERNAL", "Falla.", 500);
    api.customers.ledger.mockRejectedValue(serverError);
    await expect(getStatementWithOfflineFallback(CUSTOMER_ID)).rejects.toBe(serverError);
  });

  it("rethrows when the customer is unknown locally", async () => {
    const offline = new NetworkError("offline");
    api.customers.ledger.mockRejectedValue(offline);
    await expect(getStatementWithOfflineFallback(CUSTOMER_ID)).rejects.toBe(offline);
  });

  it("reconstructs supplier surtidas joining the compra cash move", async () => {
    const now = Date.now();
    const moveId = newEntityId();
    await getLocalDb().products.put({
      id: PRODUCT_ID,
      businessId: BIZ,
      name: "Gomitas",
      category: "General",
      price: 500,
      avgCost: 100,
      stock: 15,
      lowStockAt: 5,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await getLocalDb().stockMoves.put({
      id: moveId,
      businessId: BIZ,
      productId: PRODUCT_ID,
      delta: 5,
      reason: "surtir",
      unitCost: 100,
      supplierId: SUPPLIER_ID,
      refType: "purchase",
      refId: null,
      note: null,
      requestId: newEntityId(),
      occurredOn: "2026-09-20",
      createdAt: now,
    });
    await getLocalDb().cashMoves.put({
      id: newEntityId(),
      businessId: BIZ,
      amount: 600,
      direction: "out",
      method: "Nequi",
      kind: "compra",
      sessionId: null,
      refType: "stockMove",
      refId: moveId,
      requestId: null,
      note: null,
      occurredOn: "2026-09-20",
      createdAt: now,
    });
    const rows = await listLocalSurtidas(SUPPLIER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      productName: "Gomitas",
      qty: 5,
      totalCost: 600,
      method: "Nequi",
    });
  });

  it("surtidas without cash move fall back to unitCost x qty", async () => {
    const now = Date.now();
    await getLocalDb().stockMoves.put({
      id: newEntityId(),
      businessId: BIZ,
      productId: PRODUCT_ID,
      delta: 2,
      reason: "surtir",
      unitCost: 100,
      supplierId: SUPPLIER_ID,
      refType: "purchase",
      refId: null,
      note: null,
      requestId: null,
      occurredOn: "2026-09-20",
      createdAt: now,
    });
    const rows = await listLocalSurtidas(SUPPLIER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty: 2, totalCost: 200, method: null });
  });
});
