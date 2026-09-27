import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __reopenLocalDbForTests, __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { getOutboxStore, resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { CatalogReadCache } from "@/data/local/read-cache";
import { newEntityId } from "@/data/local/ids";
import { createCustomerWithOfflineFallback, syncPendingCustomers } from "./offline-catalog";
import { createInitialDebtWithOfflineFallback, syncPendingInitialDebts } from "./offline-initial-debt";
import { createPaymentWithOfflineFallback, syncPendingPayments } from "./offline-payments";
import { createReturnWithOfflineFallback, syncPendingReturns } from "./offline-returns";
import { createSaleWithOfflineFallback, syncPendingSales } from "./offline-sales";
import { getStatementWithOfflineFallback } from "./offline-statement";
import { pendingDebtAdjustment } from "./pending-debt";

const BIZ = "11111111-1111-4111-8111-111111111111";
const BIZ_B = "99999999-9999-4999-8999-999999999999";

const api = {
  session: { businessId: BIZ },
  customers: {
    create: vi.fn(),
    get: vi.fn(),
    initialDebt: vi.fn(),
    pay: vi.fn(),
    ledger: vi.fn(),
  },
  sales: {
    create: vi.fn(),
    createReturn: vi.fn(),
  },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

function reopen() {
  resetOutboxStoreSingleton();
  resetOutboxSyncEngineSingleton();
  resetLocalStoreSingleton();
  __reopenLocalDbForTests();
}

async function seedCustomer(id: string, businessId: string, debt: number) {
  const now = Date.now();
  await getLocalDb().customers.put({
    id,
    businessId,
    code: "DC-0001",
    name: "Ana",
    phone: null,
    debt,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function seedProduct(id: string, businessId: string, stock: number, price = 1_000) {
  const now = Date.now();
  await getLocalDb().products.put({
    id,
    businessId,
    name: "Gomitas",
    category: "General",
    price,
    avgCost: 400,
    stock,
    lowStockAt: 1,
    sellable: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    images: [],
  });
}

describe("offline chaos and financial consistency", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = BIZ;
    api.customers.ledger.mockRejectedValue(new NetworkError("offline"));
    api.customers.create.mockReset();
    api.customers.get.mockReset();
    api.customers.initialDebt.mockReset();
    api.customers.pay.mockReset();
    api.sales.create.mockReset();
    api.sales.createReturn.mockReset();
  });

  afterEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("C1 and C10 survive reload between customer, debt and sync", async () => {
    api.customers.create.mockRejectedValueOnce(new NetworkError("offline"));
    const created = await createCustomerWithOfflineFallback({ name: "Ana" }, newEntityId());
    if (created.mode !== "offline") throw new Error("expected offline customer");
    reopen();
    const debt = await createInitialDebtWithOfflineFallback(
      { customerId: created.customerId, amount: 20_000 },
      newEntityId(),
    );
    if (debt.mode !== "offline") throw new Error("expected offline debt");
    const debtOp = await getLocalDb().outbox.get(debt.debtId);
    expect(debtOp?.dependsOn.length).toBe(1);
    reopen();
    expect(await getLocalDb().outbox.get(debt.debtId)).toMatchObject({
      status: "pending",
      dependsOn: debtOp?.dependsOn,
    });

    const remoteId = newEntityId();
    api.customers.create.mockResolvedValue({
      id: remoteId,
      code: "DC-0001",
      name: "Ana",
      phone: null,
      debt: 0,
      archivedAt: null,
      createdAt: Date.now(),
    });
    let serverDebt = 0;
    api.customers.get.mockImplementation(async () => ({
      id: remoteId,
      code: "DC-0001",
      name: "Ana",
      phone: null,
      debt: serverDebt,
      archivedAt: null,
      createdAt: Date.now(),
    }));
    api.customers.initialDebt.mockImplementation(async (id: string, body: { amount: number }, requestId: string) => {
      expect(id).toBe(remoteId);
      serverDebt += body.amount;
      return {
        id: newEntityId(),
        customerId: id,
        amount: body.amount,
        note: null,
        occurredOn: "2026-09-27",
        createdAt: Date.now(),
        requestId,
      };
    });
    await syncPendingCustomers(BIZ);
    await syncPendingInitialDebts(BIZ);
    expect(serverDebt).toBe(20_000);
    expect(await getLocalDb().initialDebts.count()).toBe(1);
    expect((await getLocalDb().customers.get(remoteId))?.debt).toBe(20_000);
    expect(await getLocalDb().customers.get(created.customerId)).toBeUndefined();
  });

  it("C2 resumes when sync stops between customer and debt", async () => {
    api.customers.create.mockRejectedValueOnce(new NetworkError("offline"));
    const created = await createCustomerWithOfflineFallback({ name: "Ana" }, newEntityId());
    if (created.mode !== "offline") throw new Error("expected offline customer");
    const debtRequest = newEntityId();
    const debt = await createInitialDebtWithOfflineFallback(
      { customerId: created.customerId, amount: 20_000 },
      debtRequest,
    );
    if (debt.mode !== "offline") throw new Error("expected offline debt");
    const remoteId = newEntityId();
    api.customers.create.mockResolvedValue({
      id: remoteId, code: "DC-0001", name: "Ana", phone: null, debt: 0, archivedAt: null, createdAt: Date.now(),
    });
    let serverDebt = 0;
    api.customers.get.mockImplementation(async () => ({
      id: remoteId, code: "DC-0001", name: "Ana", phone: null, debt: serverDebt, archivedAt: null, createdAt: Date.now(),
    }));
    await syncPendingCustomers(BIZ);
    expect(api.customers.initialDebt).not.toHaveBeenCalled();
    expect((await getLocalDb().outbox.get(debt.debtId))?.status).toBe("pending");
    api.customers.initialDebt.mockImplementation(async (id: string, body: { amount: number }) => {
      serverDebt += body.amount;
      return { id: newEntityId(), customerId: id, amount: body.amount, note: null, occurredOn: "2026-09-27", createdAt: Date.now() };
    });
    await syncPendingInitialDebts(BIZ);
    expect(api.customers.initialDebt).toHaveBeenCalledTimes(1);
    expect(api.customers.initialDebt).toHaveBeenCalledWith(remoteId, { amount: 20_000 }, debtRequest);
    expect(serverDebt).toBe(20_000);
  });

  it("C3 keeps 150000 across refresh, partial sync and full sync", async () => {
    const customerId = newEntityId();
    await seedCustomer(customerId, BIZ, 100_000);
    api.customers.initialDebt.mockRejectedValue(new NetworkError("offline"));
    const first = await createInitialDebtWithOfflineFallback({ customerId, amount: 20_000 }, newEntityId());
    const second = await createInitialDebtWithOfflineFallback({ customerId, amount: 30_000 }, newEntityId());
    if (first.mode !== "offline" || second.mode !== "offline") throw new Error("expected offline debts");
    await getLocalDb().outbox.update(first.debtId, { localCreatedAt: 1 });
    await getLocalDb().outbox.update(second.debtId, { localCreatedAt: 2 });
    reopen();

    const remote = {
      id: customerId, code: "DC-0001", name: "Ana", phone: null, debt: 100_000, archivedAt: null, createdAt: 1,
    };
    const cache = new CatalogReadCache();
    expect((await cache.listCustomers(BIZ, async () => [remote])).data[0]?.debt).toBe(150_000);

    let serverDebt = 100_000;
    const seen = new Set<string>();
    let blockSecond = true;
    api.customers.initialDebt.mockImplementation(async (id: string, body: { amount: number }, requestId: string) => {
      if (seen.has(requestId)) {
        return { id: requestId, customerId: id, amount: body.amount, note: null, occurredOn: "2026-09-27", createdAt: 1 };
      }
      if (body.amount === 30_000 && blockSecond) throw new NetworkError("offline");
      seen.add(requestId);
      serverDebt += body.amount;
      return { id: newEntityId(), customerId: id, amount: body.amount, note: null, occurredOn: "2026-09-27", createdAt: 1 };
    });
    api.customers.get.mockImplementation(async () => ({ ...remote, debt: serverDebt }));
    await syncPendingInitialDebts(BIZ);
    expect(serverDebt).toBe(120_000);
    expect((await cache.listCustomers(BIZ, async () => [{ ...remote, debt: serverDebt }])).data[0]?.debt).toBe(150_000);
    const blocked = await getOutboxStore().get(BIZ, second.debtId);
    await getLocalDb().outbox.update(second.debtId, { nextAttemptAt: 1 });
    expect(blocked?.status).not.toBe("synced");
    blockSecond = false;
    await syncPendingInitialDebts(BIZ);
    expect(serverDebt).toBe(150_000);
    expect((await cache.listCustomers(BIZ, async () => [{ ...remote, debt: serverDebt }])).data[0]?.debt).toBe(150_000);
    expect(await pendingDebtAdjustment(BIZ, customerId)).toBe(0);
  });

  it("C4 a permanent rejection stays gone after refresh", async () => {
    const customerId = newEntityId();
    await seedCustomer(customerId, BIZ, 100_000);
    api.customers.initialDebt.mockRejectedValueOnce(new NetworkError("offline"));
    await createInitialDebtWithOfflineFallback({ customerId, amount: 20_000 }, newEntityId());
    api.customers.initialDebt.mockRejectedValue(new ApiError("VALIDATION", "no", 400));
    await syncPendingInitialDebts(BIZ);
    const cache = new CatalogReadCache();
    const listed = await cache.listCustomers(BIZ, async () => [{
      id: customerId, code: "DC-0001", name: "Ana", phone: null, debt: 100_000, archivedAt: null, createdAt: 1,
    }]);
    expect(listed.data[0]?.debt).toBe(100_000);
    const statement = await getStatementWithOfflineFallback(customerId);
    expect(statement?.statement.total).toBe(100_000);
    expect(statement?.statement.entries.some((entry) => entry.kind === "inicial")).toBe(false);
  });

  it("C5 a pending return stays visible once and confirms once", async () => {
    const customerId = newEntityId();
    const productId = newEntityId();
    const saleId = newEntityId();
    const lineId = newEntityId();
    const now = 1_700_000_000_000;
    await seedCustomer(customerId, BIZ, 50_000);
    await seedProduct(productId, BIZ, 10);
    await getLocalDb().sales.put({
      id: saleId, businessId: BIZ, customerId, paymentKind: "credit", method: null,
      saleTotal: 50_000, amountReceived: 0, credit: 50_000, requestId: newEntityId(),
      note: null, occurredOn: "2026-09-27", createdAt: now, updatedAt: now,
    });
    await getLocalDb().saleLines.put({
      id: lineId, businessId: BIZ, saleId, productId, productName: "Gomitas",
      qty: 50, unitPrice: 1_000, unitCost: 400, lineTotal: 50_000, createdAt: now,
    });
    api.sales.createReturn.mockRejectedValue(new NetworkError("offline"));
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 20 }], newEntityId());
    expect((await getLocalDb().products.get(productId))?.stock).toBe(10);
    expect(await getLocalDb().saleReturns.count()).toBe(0);
    const pending = await getStatementWithOfflineFallback(customerId);
    expect(pending?.statement.total).toBe(30_000);
    expect(pending?.statement.entries.filter((entry) => entry.kind === "devolucion")).toEqual([
      expect.objectContaining({ amount: 20_000, pending: true }),
    ]);
    const cache = new CatalogReadCache();
    const listed = await cache.listCustomers(BIZ, async () => [{
      id: customerId, code: "DC-0001", name: "Ana", phone: null, debt: 50_000, archivedAt: null, createdAt: 1,
    }]);
    expect(listed.data[0]?.debt).toBe(30_000);

    api.sales.createReturn.mockResolvedValue({
      id: newEntityId(), saleId, refundAmount: 0, debtReduced: 20_000, method: null, note: null,
      occurredOn: "2026-09-27", createdAt: Date.now(),
      lines: [{ id: newEntityId(), saleLineId: lineId, productId, qty: 20, unitPrice: 1_000, unitCost: 400 }],
    });
    api.customers.get.mockResolvedValue({
      id: customerId, code: "DC-0001", name: "Ana", phone: null, debt: 30_000, archivedAt: null, createdAt: 1,
    });
    await syncPendingReturns(BIZ);
    await syncPendingReturns(BIZ);
    expect(api.sales.createReturn).toHaveBeenCalledTimes(2);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(30);
    const confirmed = await getStatementWithOfflineFallback(customerId);
    const returns = confirmed?.statement.entries.filter((entry) => entry.kind === "devolucion") ?? [];
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({ amount: 20_000 });
    expect(returns[0] && "pending" in returns[0] ? returns[0].pending : undefined).toBeUndefined();
    expect(confirmed?.statement.total).toBe(30_000);
  });

  it("C6 rolls a rejected return back once, including a manual retry", async () => {
    const customerId = newEntityId();
    const productId = newEntityId();
    const saleId = newEntityId();
    const lineId = newEntityId();
    const now = Date.now();
    await seedCustomer(customerId, BIZ, 20_000);
    await seedProduct(productId, BIZ, 8);
    await getLocalDb().sales.put({
      id: saleId, businessId: BIZ, customerId, paymentKind: "credit", method: null,
      saleTotal: 20_000, amountReceived: 0, credit: 20_000, requestId: newEntityId(),
      note: null, occurredOn: "2026-09-27", createdAt: now, updatedAt: now,
    });
    await getLocalDb().saleLines.put({
      id: lineId, businessId: BIZ, saleId, productId, productName: "Gomitas",
      qty: 20, unitPrice: 1_000, unitCost: 400, lineTotal: 20_000, createdAt: now,
    });
    const requestId = newEntityId();
    api.sales.createReturn.mockRejectedValueOnce(new NetworkError("offline"));
    const queued = await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 20 }], requestId);
    if (queued.mode !== "offline") throw new Error("expected offline return");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(0);
    api.sales.createReturn.mockRejectedValue(new ApiError("RETURN_EXCEEDS", "no", 409));
    await syncPendingReturns(BIZ);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(20_000);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(8);
    expect(await getLocalDb().cashMoves.count()).toBe(0);
    const op = await getOutboxStore().get(BIZ, queued.operationId);
    expect(op?.status).toBe("failed");
    expect(op?.nextAttemptAt).toBeNull();
    await getOutboxStore().requeue(BIZ, queued.operationId);
    await syncPendingReturns(BIZ);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(20_000);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(8);
    expect((await getOutboxStore().get(BIZ, queued.operationId))?.requestId).toBe(requestId);
  });

  it("C7 keeps a 401 pending and retries the same request after the session recovers", async () => {
    const customerId = newEntityId();
    await seedCustomer(customerId, BIZ, 100_000);
    const requestId = newEntityId();
    api.customers.initialDebt.mockRejectedValueOnce(new NetworkError("offline"));
    const created = await createInitialDebtWithOfflineFallback({ customerId, amount: 20_000 }, requestId);
    if (created.mode !== "offline") throw new Error("expected offline debt");
    api.customers.initialDebt.mockRejectedValueOnce(new ApiError("UNAUTHORIZED", "entra", 401));
    const paused = await syncPendingInitialDebts(BIZ);
    expect(paused.authRequired).toBe(true);
    const op = await getOutboxStore().get(BIZ, created.debtId);
    expect(op?.status).toBe("pending");
    expect(op?.requestId).toBe(requestId);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(120_000);

    api.customers.initialDebt.mockResolvedValue({
      id: newEntityId(), customerId, amount: 20_000, note: null, occurredOn: "2026-09-27", createdAt: Date.now(),
    });
    api.customers.get.mockResolvedValue({
      id: customerId, code: "DC-0001", name: "Ana", phone: null, debt: 120_000, archivedAt: null, createdAt: 1,
    });
    await syncPendingInitialDebts(BIZ);
    expect(api.customers.initialDebt).toHaveBeenLastCalledWith(customerId, { amount: 20_000 }, requestId);
    expect((await getOutboxStore().get(BIZ, created.debtId))?.status).toBe("synced");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(120_000);
  });

  it("C8 a 403 rolls the debt and the sale back once and does not look synced", async () => {
    const customerId = newEntityId();
    const productId = newEntityId();
    await seedCustomer(customerId, BIZ, 100_000);
    await seedProduct(productId, BIZ, 10, 50_000);
    const debtRequest = newEntityId();
    api.customers.initialDebt.mockRejectedValueOnce(new NetworkError("offline"));
    const debt = await createInitialDebtWithOfflineFallback({ customerId, amount: 20_000 }, debtRequest);
    if (debt.mode !== "offline") throw new Error("expected offline debt");
    api.customers.initialDebt.mockRejectedValue(new ApiError("FORBIDDEN", "no", 403));
    await syncPendingInitialDebts(BIZ);
    expect((await getOutboxStore().get(BIZ, debt.debtId))?.status).toBe("failed");
    expect((await getOutboxStore().get(BIZ, debt.debtId))?.nextAttemptAt).toBeNull();
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(100_000);
    await getOutboxStore().requeue(BIZ, debt.debtId);
    await syncPendingInitialDebts(BIZ);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(100_000);

    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId, qty: 1, unitPrice: 50_000 }],
        paymentKind: "credit",
        customerId,
        amountReceived: 0,
      },
      newEntityId(),
    );
    if (sale.mode !== "offline") throw new Error("expected offline sale");
    expect((await getLocalDb().products.get(productId))?.stock).toBe(9);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(150_000);
    api.sales.create.mockRejectedValue(new ApiError("FORBIDDEN", "no", 403));
    await syncPendingSales(BIZ);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(10);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(100_000);
    expect((await getOutboxStore().get(BIZ, sale.saleId))?.status).toBe("failed");
    const sent = api.sales.create.mock.calls.at(-1)?.[0] as { optimisticApplied?: unknown };
    expect(sent.optimisticApplied).toBeUndefined();
    await getOutboxStore().requeue(BIZ, sale.saleId);
    api.sales.create.mockResolvedValue({ id: newEntityId() });
    await syncPendingSales(BIZ);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(9);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(150_000);
    expect((await getOutboxStore().get(BIZ, sale.saleId))?.status).toBe("synced");
  });

  it("C9 keeps two businesses apart while both have pending debt", async () => {
    const customerA = newEntityId();
    const customerB = newEntityId();
    await seedCustomer(customerA, BIZ, 100_000);
    await seedCustomer(customerB, BIZ_B, 80_000);
    const shared = newEntityId();
    await getOutboxStore().enqueue({
      operationId: newEntityId(), businessId: BIZ, entity: "initialDebt", operation: "create",
      requestId: shared, payload: { customerId: customerA, amount: 20_000 },
    });
    await getOutboxStore().enqueue({
      operationId: newEntityId(), businessId: BIZ_B, entity: "initialDebt", operation: "create",
      requestId: shared, payload: { customerId: customerA, amount: 70_000 },
    });
    expect(await pendingDebtAdjustment(BIZ, customerA)).toBe(20_000);
    expect(await pendingDebtAdjustment(BIZ_B, customerA)).toBe(70_000);
    expect(await pendingDebtAdjustment(BIZ, customerB)).toBe(0);
    const cache = new CatalogReadCache();
    const listed = await cache.listCustomers(BIZ, async () => [{
      id: customerA, code: "DC-0001", name: "Ana", phone: null, debt: 100_000, archivedAt: null, createdAt: 1,
    }]);
    expect(listed.data[0]?.debt).toBe(120_000);
    expect((await getLocalDb().customers.get(customerB))?.debt).toBe(80_000);
  });

  it("a rejected payment restores debt and cash once, then a retry applies it once", async () => {
    const customerId = newEntityId();
    await seedCustomer(customerId, BIZ, 100_000);
    const requestId = newEntityId();
    api.customers.pay.mockRejectedValueOnce(new NetworkError("offline"));
    const payment = await createPaymentWithOfflineFallback(
      { customerId, amount: 20_000, method: "Efectivo" },
      requestId,
    );
    if (payment.mode !== "offline") throw new Error("expected offline payment");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(80_000);
    expect(await getLocalDb().cashMoves.count()).toBe(1);
    api.customers.pay.mockRejectedValueOnce(new ApiError("FORBIDDEN", "no", 403));
    await syncPendingPayments(BIZ);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(100_000);
    expect(await getLocalDb().cashMoves.count()).toBe(0);
    await getOutboxStore().requeue(BIZ, payment.paymentId);
    api.customers.pay.mockResolvedValue({ id: newEntityId() });
    await syncPendingPayments(BIZ);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(80_000);
    expect(await getLocalDb().cashMoves.count()).toBe(1);
    expect(api.customers.pay).toHaveBeenLastCalledWith(
      customerId,
      { amount: 20_000, method: "Efectivo" },
      requestId,
    );
  });

  it("offline ledger stays at 110000 and does not treat refund as debt", async () => {
    const customerId = newEntityId();
    const productId = newEntityId();
    const saleId = newEntityId();
    const lineId = newEntityId();
    const now = 1_700_000_000_000;
    await seedCustomer(customerId, BIZ, 130_000);
    await seedProduct(productId, BIZ, 10);
    await getLocalDb().initialDebts.put({
      id: newEntityId(), businessId: BIZ, customerId, amount: 100_000, note: null,
      requestId: newEntityId(), occurredOn: "2026-09-27", createdAt: now,
    });
    await getLocalDb().sales.put({
      id: saleId, businessId: BIZ, customerId, paymentKind: "credit", method: null,
      saleTotal: 50_000, amountReceived: 0, credit: 50_000, requestId: newEntityId(),
      note: null, occurredOn: "2026-09-27", createdAt: now + 1, updatedAt: now + 1,
    });
    await getLocalDb().saleLines.put({
      id: lineId, businessId: BIZ, saleId, productId, productName: "Gomitas",
      qty: 50, unitPrice: 1_000, unitCost: 400, lineTotal: 50_000, createdAt: now + 1,
    });
    await getLocalDb().customerPayments.put({
      id: newEntityId(), businessId: BIZ, customerId, amount: 20_000, method: "Efectivo",
      saleId: null, requestId: newEntityId(), note: null, occurredOn: "2026-09-27", createdAt: now + 2,
    });
    api.sales.createReturn.mockRejectedValue(new NetworkError("offline"));
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 20 }], newEntityId());
    const statement = await getStatementWithOfflineFallback(customerId);
    expect(statement?.statement.total).toBe(110_000);
    const back = statement?.statement.entries.at(-1);
    expect(back?.kind).toBe("devolucion");
    if (back?.kind === "devolucion") expect(back.amount).toBe(20_000);
    expect(back?.runningBalance).toBe(110_000);
  });
});
