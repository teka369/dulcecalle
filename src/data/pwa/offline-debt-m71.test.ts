import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __reopenLocalDbForTests, __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { getOutboxStore, resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { CatalogReadCache } from "@/data/local/read-cache";
import { getLocalStore, resetLocalStoreSingleton } from "@/data/local/store";
import { createCustomerWithOfflineFallback, syncPendingCustomers } from "./offline-catalog";
import { createInitialDebtWithOfflineFallback, syncPendingInitialDebts } from "./offline-initial-debt";
import { createReturnWithOfflineFallback, syncPendingReturns } from "./offline-returns";
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
    ledger: vi.fn(),
  },
  sales: {
    createReturn: vi.fn(),
  },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("../http/session", () => ({ getPwaAuthSession: () => ({ businessId: BIZ }) }));

function remoteCustomer(id: string, debt: number, name = "Ana") {
  return {
    id,
    code: "DC-0001",
    name,
    phone: null,
    debt,
    archivedAt: null,
    createdAt: 1_700_000_000_000,
  };
}

async function seedCustomer(opts: {
  id?: string;
  businessId?: string;
  debt?: number;
  name?: string;
  requestId?: string;
}) {
  const now = Date.now();
  const id = opts.id ?? newEntityId();
  await getLocalDb().customers.put({
    id,
    businessId: opts.businessId ?? BIZ,
    code: opts.requestId ? null : "DC-0001",
    name: opts.name ?? "Ana",
    phone: null,
    debt: opts.debt ?? 0,
    archivedAt: null,
    requestId: opts.requestId,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

function cache() {
  return new CatalogReadCache(getLocalStore(), getLocalDb());
}

describe("M7.1 offline debt reconciliation", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    api.session.businessId = BIZ;
    api.customers.create.mockReset();
    api.customers.get.mockReset();
    api.customers.initialDebt.mockReset();
    api.customers.ledger.mockReset();
    api.sales.createReturn.mockReset();
    api.customers.ledger.mockRejectedValue(new NetworkError("offline"));
    api.sales.createReturn.mockRejectedValue(new NetworkError("offline"));
  });

  afterEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("T1 remote customer + offline initial debt syncs once", async () => {
    const customerId = await seedCustomer({ debt: 100_000 });
    const requestId = newEntityId();
    let serverDebt = 100_000;
    const remoteDebtId = newEntityId();
    api.customers.initialDebt.mockRejectedValueOnce(new NetworkError("offline"));
    const created = await createInitialDebtWithOfflineFallback(
      { customerId, amount: 20_000 },
      requestId,
    );
    if (created.mode !== "offline") throw new Error("expected offline initial debt");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(120_000);
    expect(await getLocalDb().initialDebts.count()).toBe(1);
    expect(await getLocalDb().outbox.count()).toBe(1);

    api.customers.initialDebt.mockImplementation(async (id: string, body: { amount: number }, key: string) => {
      expect(id).toBe(customerId);
      expect(key).toBe(requestId);
      serverDebt += body.amount;
      return {
        id: remoteDebtId,
        customerId: id,
        amount: body.amount,
        note: null,
        occurredOn: "2026-09-27",
        createdAt: Date.now(),
      };
    });
    api.customers.get.mockImplementation(async (id: string) => remoteCustomer(id, serverDebt));

    const result = await syncPendingInitialDebts(BIZ);
    expect(result.synced).toBe(1);
    expect(serverDebt).toBe(120_000);
    expect(api.customers.initialDebt).toHaveBeenLastCalledWith(customerId, { amount: 20_000 }, requestId);
    expect(await getLocalDb().initialDebts.get(created.debtId)).toBeUndefined();
    expect(await getLocalDb().initialDebts.count()).toBe(1);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(120_000);

    await syncPendingInitialDebts(BIZ);
    expect(serverDebt).toBe(120_000);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(120_000);
  });

  it("T2 offline customer + initial debt reaches Postgres once under the remote id", async () => {
    const customerRequest = newEntityId();
    const debtRequest = newEntityId();
    api.customers.create.mockRejectedValueOnce(new NetworkError("offline"));
    const createdCustomer = await createCustomerWithOfflineFallback({ name: "Ana" }, customerRequest);
    if (createdCustomer.mode !== "offline") throw new Error("expected offline customer");
    const localId = createdCustomer.customerId;

    const createdDebt = await createInitialDebtWithOfflineFallback(
      { customerId: localId, amount: 20_000 },
      debtRequest,
    );
    if (createdDebt.mode !== "offline") throw new Error("expected offline initial debt");
    expect(api.customers.initialDebt).not.toHaveBeenCalled();
    const debtOp = await getOutboxStore().getByRequestId(BIZ, debtRequest);
    const customerOp = await getOutboxStore().getByRequestId(BIZ, customerRequest);
    expect(debtOp?.dependsOn).toEqual([customerOp?.operationId]);
    expect((await getLocalDb().customers.get(localId))?.debt).toBe(20_000);

    const remoteId = newEntityId();
    let serverDebt = 0;
    api.customers.create.mockResolvedValue({
      id: remoteId,
      code: "DC-0099",
      name: "Ana",
      phone: null,
      debt: 0,
      archivedAt: null,
      createdAt: Date.now(),
    });
    api.customers.get.mockImplementation(async (id: string) => remoteCustomer(id, serverDebt, "Ana"));
    await syncPendingCustomers(BIZ);
    expect(await getLocalDb().customers.get(localId)).toBeUndefined();
    expect((await getLocalDb().customers.get(remoteId))?.debt).toBe(20_000);
    expect((await getLocalDb().initialDebts.get(createdDebt.debtId))?.customerId).toBe(remoteId);
    expect((await getOutboxStore().getByRequestId(BIZ, debtRequest))?.payload).toMatchObject({
      customerId: remoteId,
      amount: 20_000,
    });
    expect((await getOutboxStore().getByRequestId(BIZ, debtRequest))?.dependsOn).toEqual([
      customerOp?.operationId,
    ]);
    expect(api.customers.initialDebt).not.toHaveBeenCalled();

    const remoteDebtId = newEntityId();
    api.customers.initialDebt.mockImplementation(async (id: string, body: { amount: number }, key: string) => {
      expect(id).toBe(remoteId);
      expect(key).toBe(debtRequest);
      serverDebt += body.amount;
      return {
        id: remoteDebtId,
        customerId: id,
        amount: body.amount,
        note: null,
        occurredOn: "2026-09-27",
        createdAt: Date.now(),
      };
    });
    const synced = await syncPendingInitialDebts(BIZ);
    expect(synced.synced).toBe(1);
    expect(serverDebt).toBe(20_000);
    expect(api.customers.initialDebt).toHaveBeenCalledTimes(1);
    expect(api.customers.initialDebt).toHaveBeenCalledWith(remoteId, { amount: 20_000 }, debtRequest);
    for (const call of api.customers.initialDebt.mock.calls) {
      expect(call[0]).not.toBe(localId);
    }
    expect(await getLocalDb().customers.get(localId)).toBeUndefined();
    expect(await getLocalDb().initialDebts.count()).toBe(1);
    expect((await getLocalDb().initialDebts.toArray())[0]).toMatchObject({
      id: remoteDebtId,
      customerId: remoteId,
      amount: 20_000,
      requestId: debtRequest,
    });
    expect((await getLocalDb().customers.get(remoteId))?.debt).toBe(20_000);
    expect((await getOutboxStore().getByRequestId(BIZ, debtRequest))?.status).toBe("synced");
    expect((await getOutboxStore().getByRequestId(BIZ, debtRequest))?.requestId).toBe(debtRequest);
  });

  it("T3 reload before sync keeps the customer dependency and the optimistic debt", async () => {
    api.customers.create.mockRejectedValueOnce(new NetworkError("offline"));
    const customerRequest = newEntityId();
    const debtRequest = newEntityId();
    const createdCustomer = await createCustomerWithOfflineFallback({ name: "Ana" }, customerRequest);
    if (createdCustomer.mode !== "offline") throw new Error("expected offline customer");
    const createdDebt = await createInitialDebtWithOfflineFallback(
      { customerId: createdCustomer.customerId, amount: 20_000 },
      debtRequest,
    );
    if (createdDebt.mode !== "offline") throw new Error("expected offline initial debt");
    const dependsOn = (await getOutboxStore().getByRequestId(BIZ, debtRequest))?.dependsOn;

    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    __reopenLocalDbForTests();

    expect(await getLocalDb().customers.get(createdCustomer.customerId)).toMatchObject({ debt: 20_000 });
    expect(await getLocalDb().initialDebts.get(createdDebt.debtId)).toMatchObject({
      customerId: createdCustomer.customerId,
      amount: 20_000,
      requestId: debtRequest,
    });
    const debtOp = await getOutboxStore().getByRequestId(BIZ, debtRequest);
    expect(debtOp?.status).toBe("pending");
    expect(debtOp?.dependsOn).toEqual(dependsOn);
    expect(debtOp?.dependsOn).toHaveLength(1);
    expect(api.customers.initialDebt).not.toHaveBeenCalled();
    expect(api.customers.create).toHaveBeenCalledTimes(1);
  });

  it("T4 remap rewrites customer refs and leaves the other business alone", async () => {
    api.customers.create.mockRejectedValueOnce(new NetworkError("offline"));
    const customerRequest = newEntityId();
    const debtRequest = newEntityId();
    const createdCustomer = await createCustomerWithOfflineFallback({ name: "Ana" }, customerRequest);
    if (createdCustomer.mode !== "offline") throw new Error("expected offline customer");
    const localId = createdCustomer.customerId;
    const createdDebt = await createInitialDebtWithOfflineFallback(
      { customerId: localId, amount: 20_000 },
      debtRequest,
    );
    if (createdDebt.mode !== "offline") throw new Error("expected offline initial debt");

    const saleId = newEntityId();
    const paymentId = newEntityId();
    const returnId = newEntityId();
    const now = Date.now();
    await getLocalDb().sales.put({
      id: saleId,
      businessId: BIZ,
      customerId: localId,
      paymentKind: "credit",
      method: null,
      saleTotal: 50_000,
      amountReceived: 0,
      credit: 50_000,
      requestId: newEntityId(),
      note: null,
      occurredOn: "2026-09-27",
      createdAt: now,
      updatedAt: now,
    });
    await getLocalDb().customerPayments.put({
      id: paymentId,
      businessId: BIZ,
      customerId: localId,
      amount: 5_000,
      method: "Efectivo",
      saleId: null,
      requestId: newEntityId(),
      note: null,
      occurredOn: "2026-09-27",
      createdAt: now,
    });
    await getLocalDb().saleReturns.put({
      id: returnId,
      businessId: BIZ,
      saleId,
      refundAmount: 0,
      debtReduced: 1_000,
      method: null,
      requestId: newEntityId(),
      note: null,
      occurredOn: "2026-09-27",
      createdAt: now,
      updatedAt: now,
    });
    const saleRequest = newEntityId();
    const payRequest = newEntityId();
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: saleRequest,
      payload: { customerId: localId, lines: [] },
    });
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "customerPayment",
      operation: "pay",
      requestId: payRequest,
      payload: { customerId: localId, amount: 5_000, method: "Efectivo" },
    });

    const bCustomer = await seedCustomer({ businessId: BIZ_B, debt: 80_000, name: "Beto" });
    const bSale = newEntityId();
    await getLocalDb().sales.put({
      id: bSale,
      businessId: BIZ_B,
      customerId: localId,
      paymentKind: "credit",
      method: null,
      saleTotal: 70_000,
      amountReceived: 0,
      credit: 70_000,
      requestId: newEntityId(),
      note: null,
      occurredOn: "2026-09-27",
      createdAt: now,
      updatedAt: now,
    });
    const sharedRequest = newEntityId();
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ_B,
      entity: "initialDebt",
      operation: "create",
      requestId: sharedRequest,
      payload: { customerId: localId, amount: 70_000 },
    });

    const remoteId = newEntityId();
    api.customers.create.mockResolvedValue({
      id: remoteId,
      code: "DC-0099",
      name: "Ana",
      phone: null,
      debt: 0,
      archivedAt: null,
      createdAt: now,
    });
    api.customers.get.mockImplementation(async (id: string) => remoteCustomer(id, 0));
    await syncPendingCustomers(BIZ);

    expect(await getLocalDb().customers.get(localId)).toBeUndefined();
    expect((await getLocalDb().sales.get(saleId))?.customerId).toBe(remoteId);
    expect((await getLocalDb().customerPayments.get(paymentId))?.customerId).toBe(remoteId);
    expect((await getLocalDb().initialDebts.get(createdDebt.debtId))?.customerId).toBe(remoteId);
    expect((await getLocalDb().saleReturns.get(returnId))?.saleId).toBe(saleId);
    expect((await getOutboxStore().getByRequestId(BIZ, debtRequest))?.payload).toMatchObject({
      customerId: remoteId,
    });
    expect((await getOutboxStore().getByRequestId(BIZ, saleRequest))?.payload).toMatchObject({
      customerId: remoteId,
    });
    expect((await getOutboxStore().getByRequestId(BIZ, payRequest))?.payload).toMatchObject({
      customerId: remoteId,
    });
    expect((await getOutboxStore().getByRequestId(BIZ, debtRequest))?.dependsOn).toHaveLength(1);

    expect((await getLocalDb().sales.get(bSale))?.customerId).toBe(localId);
    expect((await getLocalDb().customers.get(bCustomer))?.debt).toBe(80_000);
    expect((await getOutboxStore().getByRequestId(BIZ_B, sharedRequest))?.payload).toMatchObject({
      customerId: localId,
      amount: 70_000,
    });
    expect(api.customers.initialDebt).not.toHaveBeenCalled();
  });

  it("T5 two pending initial debts stay visible after only the first sync", async () => {
    const customerId = await seedCustomer({ debt: 100_000 });
    const firstRequest = newEntityId();
    const secondRequest = newEntityId();
    api.customers.initialDebt.mockRejectedValue(new NetworkError("offline"));
    const first = await createInitialDebtWithOfflineFallback({ customerId, amount: 20_000 }, firstRequest);
    const second = await createInitialDebtWithOfflineFallback({ customerId, amount: 30_000 }, secondRequest);
    if (first.mode !== "offline" || second.mode !== "offline") {
      throw new Error("expected offline initial debts");
    }
    await getLocalDb().outbox.update(first.debtId, { localCreatedAt: 1 });
    await getLocalDb().outbox.update(second.debtId, { localCreatedAt: 2 });
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(150_000);

    let serverDebt = 100_000;
    let blockSecond = true;
    const saved = new Map<string, { id: string; amount: number }>();
    api.customers.initialDebt.mockImplementation(async (id: string, body: { amount: number }, key: string) => {
      const prev = saved.get(key);
      if (prev) {
        return {
          id: prev.id,
          customerId: id,
          amount: prev.amount,
          note: null,
          occurredOn: "2026-09-27",
          createdAt: Date.now(),
        };
      }
      if (body.amount === 30_000 && blockSecond) throw new NetworkError("offline");
      serverDebt += body.amount;
      const row = { id: newEntityId(), amount: body.amount };
      saved.set(key, row);
      return {
        id: row.id,
        customerId: id,
        amount: body.amount,
        note: null,
        occurredOn: "2026-09-27",
        createdAt: Date.now(),
      };
    });
    api.customers.get.mockImplementation(async (id: string) => remoteCustomer(id, serverDebt));

    const partial = await syncPendingInitialDebts(BIZ);
    expect(partial.synced).toBe(1);
    expect(partial.failed).toBe(1);
    expect(serverDebt).toBe(120_000);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(150_000);
    const listed = await cache().listCustomers(BIZ, async () => [remoteCustomer(customerId, serverDebt)]);
    expect(listed.data[0]?.debt).toBe(150_000);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(150_000);

    const blocked = await getOutboxStore().getByRequestId(BIZ, secondRequest);
    if (!blocked) throw new Error("missing second debt");
    await getLocalDb().outbox.update(blocked.operationId, { nextAttemptAt: 1 });
    blockSecond = false;
    const rest = await syncPendingInitialDebts(BIZ);
    expect(rest.synced).toBe(1);
    expect(serverDebt).toBe(150_000);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(150_000);
    const done = await cache().listCustomers(BIZ, async () => [remoteCustomer(customerId, serverDebt)]);
    expect(done.data[0]?.debt).toBe(150_000);
    expect(done.data[0]?.debt).not.toBe(180_000);
    expect(await getLocalDb().initialDebts.count()).toBe(2);
    expect(saved.size).toBe(2);
  });

  it("T6 catalog refresh keeps pending debt instead of sticking to the server number", async () => {
    const customerId = await seedCustomer({ debt: 150_000 });
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "initialDebt",
      operation: "create",
      requestId: newEntityId(),
      payload: { customerId, amount: 20_000 },
    });
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "initialDebt",
      operation: "create",
      requestId: newEntityId(),
      payload: { customerId, amount: 30_000 },
    });
    const localRequest = newEntityId();
    const localOnly = await seedCustomer({ debt: 5_000, name: "Local", requestId: localRequest });
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "customer",
      operation: "create",
      requestId: localRequest,
      payload: { name: "Local" },
    });

    const listed = await cache().listCustomers(BIZ, async () => [remoteCustomer(customerId, 100_000)]);
    expect(listed.source).toBe("server");
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.debt).toBe(150_000);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(150_000);
    expect((await getLocalDb().customers.get(localOnly))?.debt).toBe(5_000);

    const again = await cache().listCustomers(BIZ, async () => [remoteCustomer(customerId, 100_000)]);
    expect(again.data[0]?.debt).toBe(150_000);
    const detail = await cache().getCustomer(BIZ, customerId, async () => remoteCustomer(customerId, 100_000));
    expect(detail.debt).toBe(150_000);

    const offline = await cache().listCustomers(BIZ, async () => {
      throw new NetworkError("offline");
    });
    expect(offline.source).toBe("cache");
    expect(offline.data.find((row) => row.id === customerId)?.debt).toBe(150_000);
    expect((await getLocalDb().customers.get(localOnly))?.debt).toBe(5_000);
  });

  it("T7 lost response retries the same requestId without a second debt", async () => {
    const customerId = await seedCustomer({ debt: 100_000 });
    const requestId = newEntityId();
    api.customers.initialDebt.mockRejectedValueOnce(new NetworkError("offline"));
    await createInitialDebtWithOfflineFallback({ customerId, amount: 20_000 }, requestId);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(120_000);

    let serverDebt = 100_000;
    let lost = true;
    const remoteDebtId = newEntityId();
    api.customers.initialDebt.mockImplementation(async (id: string, body: { amount: number }, key: string) => {
      expect(key).toBe(requestId);
      expect(id).toBe(customerId);
      if (lost) {
        lost = false;
        serverDebt += body.amount;
        throw new NetworkError("lost response");
      }
      return {
        id: remoteDebtId,
        customerId: id,
        amount: body.amount,
        note: null,
        occurredOn: "2026-09-27",
        createdAt: Date.now(),
      };
    });
    api.customers.get.mockImplementation(async (id: string) => remoteCustomer(id, serverDebt));

    const first = await syncPendingInitialDebts(BIZ);
    expect(first.synced).toBe(0);
    expect(first.failed).toBe(1);
    expect(serverDebt).toBe(120_000);
    const failed = await getOutboxStore().getByRequestId(BIZ, requestId);
    expect(failed?.status).toBe("failed");
    expect(failed?.nextAttemptAt).toEqual(expect.any(Number));
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(120_000);
    await getLocalDb().outbox.update(failed!.operationId, { nextAttemptAt: 1 });

    const second = await syncPendingInitialDebts(BIZ);
    expect(second.synced).toBe(1);
    expect(serverDebt).toBe(120_000);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(120_000);
    expect(await getLocalDb().initialDebts.count()).toBe(1);
    expect((await getLocalDb().initialDebts.toArray())[0]?.id).toBe(remoteDebtId);
    expect((await getOutboxStore().getByRequestId(BIZ, requestId))?.requestId).toBe(requestId);
    expect(api.customers.initialDebt.mock.calls.filter((call) => call[2] === requestId).length).toBe(3);
  });

  it("T8 permanent 4xx stops retrying and drops the projection", async () => {
    const customerId = await seedCustomer({ debt: 100_000 });
    const requestId = newEntityId();
    api.customers.initialDebt.mockRejectedValueOnce(new NetworkError("offline"));
    await createInitialDebtWithOfflineFallback({ customerId, amount: 20_000 }, requestId);
    api.customers.initialDebt.mockRejectedValue(new ApiError("VALIDATION", "Deuda rechazada", 400));

    const result = await syncPendingInitialDebts(BIZ);
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(0);
    const op = await getOutboxStore().getByRequestId(BIZ, requestId);
    expect(op?.status).toBe("failed");
    expect(op?.nextAttemptAt).toBeNull();
    expect(op?.lastError).toBe("Deuda rechazada");
    expect(op?.lastError).not.toContain("NetworkError");
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(100_000);
    expect(await pendingDebtAdjustment(BIZ, customerId)).toBe(0);

    const statement = await getStatementWithOfflineFallback(customerId);
    expect(statement?.source).toBe("cache");
    expect(statement?.statement.total).toBe(100_000);
    expect(statement?.statement.entries.some((entry) => entry.kind === "inicial")).toBe(false);

    const calls = api.customers.initialDebt.mock.calls.length;
    const again = await syncPendingInitialDebts(BIZ);
    expect(again.processed).toBe(0);
    expect(api.customers.initialDebt.mock.calls.length).toBe(calls);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(100_000);
    expect(await getLocalDb().initialDebts.count()).toBe(1);
  });

  it("T9 pending return moves the offline statement without stock or a confirmed row", async () => {
    const customerId = await seedCustomer({ debt: 130_000 });
    const saleId = newEntityId();
    const lineId = newEntityId();
    const productId = newEntityId();
    const now = 1_700_000_000_000;
    await getLocalDb().products.put({
      id: productId,
      businessId: BIZ,
      name: "Gomitas",
      category: "General",
      price: 1_000,
      avgCost: 400,
      stock: 10,
      lowStockAt: 1,
      sellable: true,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      images: [],
    });
    await getLocalDb().initialDebts.put({
      id: newEntityId(),
      businessId: BIZ,
      customerId,
      amount: 100_000,
      note: null,
      requestId: newEntityId(),
      occurredOn: "2026-09-01",
      createdAt: now,
    });
    await getLocalDb().sales.put({
      id: saleId,
      businessId: BIZ,
      customerId,
      paymentKind: "credit",
      method: null,
      saleTotal: 50_000,
      amountReceived: 0,
      credit: 50_000,
      requestId: newEntityId(),
      note: null,
      occurredOn: "2026-09-02",
      createdAt: now + 1,
      updatedAt: now + 1,
    });
    await getLocalDb().saleLines.put({
      id: lineId,
      businessId: BIZ,
      saleId,
      productId,
      productName: "Gomitas",
      qty: 50,
      unitPrice: 1_000,
      unitCost: 400,
      lineTotal: 50_000,
      createdAt: now + 1,
    });
    await getLocalDb().customerPayments.put({
      id: newEntityId(),
      businessId: BIZ,
      customerId,
      amount: 20_000,
      method: "Efectivo",
      saleId: null,
      requestId: newEntityId(),
      note: null,
      occurredOn: "2026-09-03",
      createdAt: now + 2,
    });

    const queued = await createReturnWithOfflineFallback(
      saleId,
      [{ saleLineId: lineId, qty: 20 }],
      newEntityId(),
    );
    expect(queued.mode).toBe("offline");
    expect((await getLocalDb().products.get(productId))?.stock).toBe(10);
    expect((await getLocalDb().products.get(productId))?.avgCost).toBe(400);
    expect(await getLocalDb().saleReturns.count()).toBe(0);
    expect(await getLocalDb().cashMoves.count()).toBe(0);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(110_000);

    const statement = await getStatementWithOfflineFallback(customerId);
    expect(statement?.statement.total).toBe(110_000);
    const entries = statement?.statement.entries ?? [];
    expect(entries.map((entry) => entry.kind)).toEqual(["inicial", "fiada", "abono", "devolucion"]);
    const devolucion = entries.find((entry) => entry.kind === "devolucion");
    expect(devolucion).toMatchObject({ amount: 20_000, pending: true });
    expect(entries.at(-1)?.runningBalance).toBe(110_000);
  });

  it("T10 a confirmed return is not projected twice", async () => {
    const customerId = await seedCustomer({ debt: 130_000 });
    const saleId = newEntityId();
    const lineId = newEntityId();
    const productId = newEntityId();
    const now = Date.now();
    await getLocalDb().products.put({
      id: productId,
      businessId: BIZ,
      name: "Gomitas",
      category: "General",
      price: 1_000,
      avgCost: 400,
      stock: 10,
      lowStockAt: 1,
      sellable: true,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      images: [],
    });
    await getLocalDb().sales.put({
      id: saleId,
      businessId: BIZ,
      customerId,
      paymentKind: "credit",
      method: null,
      saleTotal: 50_000,
      amountReceived: 0,
      credit: 50_000,
      requestId: newEntityId(),
      note: null,
      occurredOn: "2026-09-02",
      createdAt: now,
      updatedAt: now,
    });
    await getLocalDb().saleLines.put({
      id: lineId,
      businessId: BIZ,
      saleId,
      productId,
      productName: "Gomitas",
      qty: 50,
      unitPrice: 1_000,
      unitCost: 400,
      lineTotal: 50_000,
      createdAt: now,
    });
    const requestId = newEntityId();
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 20 }], requestId);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(10);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(110_000);

    const remoteReturnId = newEntityId();
    api.sales.createReturn.mockResolvedValue({
      id: remoteReturnId,
      saleId,
      refundAmount: 0,
      debtReduced: 20_000,
      method: null,
      note: null,
      occurredOn: "2026-09-27",
      createdAt: Date.now(),
      lines: [
        {
          id: newEntityId(),
          saleLineId: lineId,
          productId,
          qty: 20,
          unitPrice: 1_000,
          unitCost: 400,
        },
      ],
    });
    api.customers.get.mockResolvedValue(remoteCustomer(customerId, 110_000));
    const synced = await syncPendingReturns(BIZ);
    expect(synced.synced).toBe(1);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(30);
    expect((await getLocalDb().products.get(productId))?.avgCost).toBe(400);
    expect(await getLocalDb().cashMoves.count()).toBe(0);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(110_000);
    expect(await getLocalDb().saleReturns.count()).toBe(1);

    const statement = await getStatementWithOfflineFallback(customerId);
    const returns = statement?.statement.entries.filter((entry) => entry.kind === "devolucion") ?? [];
    expect(returns).toHaveLength(1);
    expect(returns[0]).toMatchObject({ amount: 20_000 });
    expect(returns[0]?.pending).toBeUndefined();
    expect(statement?.statement.total).toBe(110_000);
  });

  it("T11 debtReduced reduces the statement and refundAmount does not", async () => {
    const customerId = await seedCustomer({ debt: 5_000 });
    const saleId = newEntityId();
    const lineId = newEntityId();
    const productId = newEntityId();
    const now = Date.now();
    await getLocalDb().products.put({
      id: productId,
      businessId: BIZ,
      name: "Torta",
      category: "General",
      price: 8_000,
      avgCost: 2_000,
      stock: 4,
      lowStockAt: 1,
      sellable: true,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      images: [],
    });
    await getLocalDb().sales.put({
      id: saleId,
      businessId: BIZ,
      customerId,
      paymentKind: "partial",
      method: "Efectivo",
      saleTotal: 8_000,
      amountReceived: 3_000,
      credit: 5_000,
      requestId: newEntityId(),
      note: null,
      occurredOn: "2026-09-27",
      createdAt: now,
      updatedAt: now,
    });
    await getLocalDb().saleLines.put({
      id: lineId,
      businessId: BIZ,
      saleId,
      productId,
      productName: "Torta",
      qty: 1,
      unitPrice: 8_000,
      unitCost: 2_000,
      lineTotal: 8_000,
      createdAt: now,
    });
    const requestId = newEntityId();
    const queued = await createReturnWithOfflineFallback(
      saleId,
      [{ saleLineId: lineId, qty: 1 }],
      requestId,
    );
    expect(queued.mode).toBe("offline");
    expect((await getLocalDb().products.get(productId))?.stock).toBe(4);
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(0);
    const op = await getOutboxStore().getByRequestId(BIZ, requestId);
    expect(op?.payload).toMatchObject({
      projectedDebtReduced: 5_000,
      projectedRefundAmount: 3_000,
    });

    const statement = await getStatementWithOfflineFallback(customerId);
    expect(statement?.statement.total).toBe(0);
    const devolucion = statement?.statement.entries.find((entry) => entry.kind === "devolucion");
    expect(devolucion).toMatchObject({ amount: 5_000, pending: true });
    expect(
      statement?.statement.entries.filter((entry) => entry.kind === "devolucion").map((entry) => entry.amount),
    ).toEqual([5_000]);
  });

  it("T12 pending debt and remap stay inside the business", async () => {
    const customerA = await seedCustomer({ debt: 100_000, name: "Ana" });
    const customerB = await seedCustomer({ businessId: BIZ_B, debt: 80_000, name: "Beto" });
    const shared = newEntityId();
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "initialDebt",
      operation: "create",
      requestId: shared,
      payload: { customerId: customerA, amount: 20_000 },
    });
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ_B,
      entity: "initialDebt",
      operation: "create",
      requestId: shared,
      payload: { customerId: customerA, amount: 70_000 },
    });

    expect(await pendingDebtAdjustment(BIZ, customerA)).toBe(20_000);
    expect(await pendingDebtAdjustment(BIZ_B, customerA)).toBe(70_000);
    expect(await pendingDebtAdjustment(BIZ, customerB)).toBe(0);
    expect(await pendingDebtAdjustment(BIZ_B, customerB)).toBe(0);

    const listed = await cache().listCustomers(BIZ, async () => [remoteCustomer(customerA, 100_000)]);
    expect(listed.data[0]?.debt).toBe(120_000);
    expect((await getLocalDb().customers.get(customerA))?.debt).toBe(120_000);
    expect((await getLocalDb().customers.get(customerB))?.debt).toBe(80_000);
    expect((await getOutboxStore().getByRequestId(BIZ_B, shared))?.payload).toMatchObject({
      customerId: customerA,
      amount: 70_000,
    });
  });
});
