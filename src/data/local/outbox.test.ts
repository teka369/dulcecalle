import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { __resetLocalDbForTests, __reopenLocalDbForTests } from "./db";
import { newEntityId, newRequestId } from "./ids";
import { getOutboxStore, resetOutboxStoreSingleton } from "./outbox";
import { resetLocalStoreSingleton } from "./store";

const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIZ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("M6 OutboxStore", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  afterEach(async () => {
    resetOutboxStoreSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("creates, keeps payload/requestId/dependsOn, lists pending FIFO per tenant", async () => {
    const outbox = getOutboxStore();
    const customerOp = newEntityId();
    const saleOp = newEntityId();
    const customerKey = newRequestId();
    const saleKey = newRequestId();
    expect(customerOp).not.toBe(customerKey);

    await outbox.enqueue({
      operationId: customerOp,
      businessId: BIZ_A,
      entity: "customer",
      operation: "create",
      requestId: customerKey,
      payload: { name: "Rosa" },
      localCreatedAt: 100,
    });
    await outbox.enqueue({
      operationId: saleOp,
      businessId: BIZ_A,
      entity: "sale",
      operation: "create",
      requestId: saleKey,
      payload: { customerId: customerOp },
      dependsOn: [customerOp],
      localCreatedAt: 200,
    });
    await outbox.enqueue({
      operationId: newEntityId(),
      businessId: BIZ_B,
      entity: "customer",
      operation: "create",
      requestId: newRequestId(),
      payload: { name: "Otra" },
      localCreatedAt: 150,
    });

    const pendingA = await outbox.listPending(BIZ_A);
    expect(pendingA).toHaveLength(2);
    expect(pendingA[0].operationId).toBe(customerOp);
    expect(pendingA[1].operationId).toBe(saleOp);
    expect(pendingA[0].requestId).toBe(customerKey);
    expect(pendingA[0].payload).toEqual({ name: "Rosa" });
    expect(pendingA[1].dependsOn).toEqual([customerOp]);
    expect(pendingA.every((row) => row.businessId === BIZ_A)).toBe(true);

    const pendingB = await outbox.listPending(BIZ_B);
    expect(pendingB).toHaveLength(1);
    expect(pendingB[0].payload).toEqual({ name: "Otra" });

    const byKey = await outbox.getByRequestId(BIZ_A, customerKey);
    expect(byKey?.operationId).toBe(customerOp);
    expect(await outbox.getByRequestId(BIZ_B, customerKey)).toBeUndefined();
  });

  it("persists after recreating the Dexie instance", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    const requestId = newRequestId();
    await outbox.enqueue({
      operationId,
      businessId: BIZ_A,
      entity: "product",
      operation: "create",
      requestId,
      payload: { name: "Galleta" },
    });
    resetOutboxStoreSingleton();
    __reopenLocalDbForTests();
    const reopened = getOutboxStore();
    const row = await reopened.get(operationId);
    expect(row?.requestId).toBe(requestId);
    expect(row?.status).toBe("pending");
    expect(row?.payload).toEqual({ name: "Galleta" });
  });

  it("transitions pending → in_flight → synced / failed", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    await outbox.enqueue({
      operationId,
      businessId: BIZ_A,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: { n: 1 },
    });
    const flying = await outbox.markInFlight(operationId);
    expect(flying.status).toBe("in_flight");
    expect(flying.attempts).toBe(1);
    expect(await outbox.listPending(BIZ_A)).toHaveLength(0);

    const remoteId = newEntityId();
    const synced = await outbox.markSynced(operationId, remoteId);
    expect(synced.status).toBe("synced");
    expect(synced.remoteId).toBe(remoteId);

    const other = newEntityId();
    await outbox.enqueue({
      operationId: other,
      businessId: BIZ_A,
      entity: "expense",
      operation: "create",
      requestId: newRequestId(),
      payload: { amount: 500 },
    });
    await outbox.markInFlight(other);
    const failed = await outbox.markFailed(other, "INSUFFICIENT_STOCK", 9);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toBe("INSUFFICIENT_STOCK");
    expect(failed.nextAttemptAt).toBe(9);
    expect(failed.attempts).toBe(1);
  });

  it("retries reuse operationId+requestId and reject a new requestId", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    const requestId = newRequestId();
    const first = await outbox.enqueue({
      operationId,
      businessId: BIZ_A,
      entity: "customer",
      operation: "create",
      requestId,
      payload: { name: "Rosa" },
    });
    const retry = await outbox.enqueue({
      operationId,
      businessId: BIZ_A,
      entity: "customer",
      operation: "create",
      requestId,
      payload: { name: "Rosa otra" },
    });
    expect(retry.operationId).toBe(first.operationId);
    expect(retry.requestId).toBe(requestId);
    expect(retry.payload).toEqual({ name: "Rosa" });

    await expect(
      outbox.enqueue({
        operationId,
        businessId: BIZ_A,
        entity: "customer",
        operation: "create",
        requestId: newRequestId(),
        payload: { name: "Rosa" },
      }),
    ).rejects.toThrow(/different requestId/);

    await expect(
      outbox.enqueue({
        operationId: newEntityId(),
        businessId: BIZ_A,
        entity: "customer",
        operation: "create",
        requestId,
        payload: { name: "Copia" },
      }),
    ).rejects.toThrow(/requestId already used/);
  });
});
