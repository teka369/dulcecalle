import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb, __reopenLocalDbForTests } from "@/data/local/db";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { getOutboxStore, resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";

const businessId = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const remoteCustomerId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";

const api = {
  session: { businessId },
  customers: {
    initialDebt: vi.fn(),
    get: vi.fn(),
  },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("../http/session", () => ({ getPwaAuthSession: () => ({ businessId }) }));

import {
  createInitialDebtWithOfflineFallback,
  syncPendingInitialDebts,
} from "./offline-initial-debt";

describe("M7 offline initial debt", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  async function seedCustomer(id = customerId, debt = 10_000, request?: string) {
    await getLocalDb().customers.put({
      id,
      businessId,
      code: "DC-0001",
      name: "Ana",
      phone: null,
      debt,
      archivedAt: null,
      requestId: request,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  it("writes one optimistic initial debt and one outbox intent on NetworkError", async () => {
    api.customers.initialDebt.mockRejectedValue(new NetworkError("offline"));
    await seedCustomer();

    const result = await createInitialDebtWithOfflineFallback(
      { customerId, amount: 5_000 },
      requestId,
    );
    expect(result.mode).toBe("offline");

    const db = getLocalDb();
    expect(await db.customers.get(customerId)).toMatchObject({ debt: 15_000 });
    expect(await db.initialDebts.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
    expect(await db.outbox.get(result.debtId)).toMatchObject({
      entity: "initialDebt",
      operation: "create",
      requestId,
      dependsOn: [],
      status: "pending",
      payload: { customerId, amount: 5_000 },
    });
  });

  it("reuses the same operation on retry and survives a reopen", async () => {
    api.customers.initialDebt.mockRejectedValue(new NetworkError("offline"));
    await seedCustomer();
    const first = await createInitialDebtWithOfflineFallback({ customerId, amount: 5_000 }, requestId);
    const second = await createInitialDebtWithOfflineFallback({ customerId, amount: 5_000 }, requestId);
    expect(second).toEqual(first);
    expect(await getLocalDb().outbox.count()).toBe(1);

    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    __reopenLocalDbForTests();

    expect(await getLocalDb().initialDebts.count()).toBe(1);
    expect(await getLocalDb().customers.get(customerId)).toMatchObject({ debt: 15_000 });
  });

  it("depends on a pending offline customer and sends the remote id only after sync", async () => {
    api.customers.initialDebt.mockRejectedValue(new NetworkError("offline"));
    const customerRequest = "55555555-5555-4555-8555-555555555555";
    await seedCustomer(customerId, 0, customerRequest);
    await getOutboxStore().enqueue({
      operationId: "66666666-6666-4666-8666-666666666666",
      businessId,
      entity: "customer",
      operation: "create",
      requestId: customerRequest,
      payload: { name: "Ana" },
      dependsOn: [],
    });

    const result = await createInitialDebtWithOfflineFallback({ customerId, amount: 7_000 }, requestId);
    expect(result.mode).toBe("offline");
    const row = await getOutboxStore().getByRequestId(businessId, requestId);
    expect(row?.dependsOn).toEqual(["66666666-6666-4666-8666-666666666666"]);
  });

  it("syncs with Idempotency-Key requestId and reconciles the local debt row", async () => {
    api.customers.initialDebt.mockRejectedValueOnce(new NetworkError("offline"));
    await seedCustomer();
    const local = await createInitialDebtWithOfflineFallback({ customerId, amount: 5_000 }, requestId);
    api.customers.initialDebt.mockResolvedValue({
      id: "77777777-7777-4777-8777-777777777777",
      customerId: remoteCustomerId,
      amount: 5_000,
      note: null,
      occurredOn: "2026-09-27",
      createdAt: Date.now(),
    });
    api.customers.get.mockResolvedValue({
      id: remoteCustomerId,
      code: "DC-0042",
      name: "Ana",
      phone: null,
      debt: 15_000,
      archivedAt: null,
      createdAt: Date.now(),
    });

    const result = await syncPendingInitialDebts(businessId);
    expect(result.synced).toBe(1);
    expect(api.customers.initialDebt).toHaveBeenCalledWith(
      customerId,
      { amount: 5_000 },
      requestId,
    );
    expect(await getLocalDb().initialDebts.get(local.debtId)).toBeUndefined();
    expect(await getLocalDb().initialDebts.get("77777777-7777-4777-8777-777777777777")).toBeTruthy();
    expect(await getLocalDb().customers.get(remoteCustomerId)).toMatchObject({ debt: 15_000 });
  });
});
