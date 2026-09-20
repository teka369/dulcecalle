import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ApiError } from "../errors";
import { __resetLocalDbForTests, __reopenLocalDbForTests } from "./db";
import { newEntityId, newRequestId } from "./ids";
import {
  ConnectivityMonitor,
  getOutboxStore,
  OutboxSyncEngine,
  resetOutboxStoreSingleton,
} from "./outbox";
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
    const row = await reopened.get(BIZ_A, operationId);
    expect(row?.requestId).toBe(requestId);
    expect(row?.status).toBe("pending");
    expect(row?.payload).toEqual({ name: "Galleta" });
    expect(await reopened.get(BIZ_B, operationId)).toBeUndefined();
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
    const flying = await outbox.markInFlight(BIZ_A, operationId);
    expect(flying.status).toBe("in_flight");
    expect(flying.attempts).toBe(1);
    expect(await outbox.listPending(BIZ_A)).toHaveLength(0);

    const remoteId = newEntityId();
    const synced = await outbox.markSynced(BIZ_A, operationId, remoteId);
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
    await outbox.markInFlight(BIZ_A, other);
    const failed = await outbox.markFailed(BIZ_A, other, "INSUFFICIENT_STOCK", 9);
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

  it("does not return a Business A operationId to Business B", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    await outbox.enqueue({
      operationId,
      businessId: BIZ_A,
      entity: "customer",
      operation: "create",
      requestId: newRequestId(),
      payload: { name: "Rosa" },
    });
    expect(await outbox.get(BIZ_B, operationId)).toBeUndefined();
    expect((await outbox.get(BIZ_A, operationId))?.payload).toEqual({
      name: "Rosa",
    });
  });
});


describe("M6.4 OutboxSyncEngine", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    await __resetLocalDbForTests();
  });

  afterEach(async () => {
    resetOutboxStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("recovers in-flight work after a reload and sends it with the stored requestId", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    const requestId = newRequestId();
    await outbox.enqueue({
      operationId,
      businessId: BIZ_A,
      entity: "customer",
      operation: "create",
      requestId,
      payload: { name: "Rosa" },
    });
    await outbox.markInFlight(BIZ_A, operationId);
    const engine = new OutboxSyncEngine(outbox, () => 10_000);
    const seen: string[] = [];
    const result = await engine.flush(BIZ_A, async (item) => {
      seen.push(item.requestId);
      return { remoteId: newEntityId() };
    });
    expect(result.synced).toBe(1);
    expect(seen).toEqual([requestId]);
    expect((await outbox.get(BIZ_A, operationId))?.status).toBe("synced");
  });

  it("honors dependencies before sending a child operation", async () => {
    const outbox = getOutboxStore();
    const parent = newEntityId();
    const child = newEntityId();
    await outbox.enqueue({ operationId: parent, businessId: BIZ_A, entity: "customer", operation: "create", requestId: newRequestId(), payload: { name: "Rosa" }, localCreatedAt: 200 });
    await outbox.enqueue({ operationId: child, businessId: BIZ_A, entity: "sale", operation: "create", requestId: newRequestId(), payload: { customerId: parent }, dependsOn: [parent], localCreatedAt: 100 });
    const sent: string[] = [];
    const result = await new OutboxSyncEngine(outbox, () => 20_000).flush(BIZ_A, async (item) => {
      sent.push(item.operationId);
      return { remoteId: newEntityId() };
    });
    expect(result.synced).toBe(2);
    expect(sent).toEqual([parent, child]);
  });

  it("backs off on network failure and stops without losing the request", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    const requestId = newRequestId();
    await outbox.enqueue({ operationId, businessId: BIZ_A, entity: "sale", operation: "create", requestId, payload: {} });
    const engine = new OutboxSyncEngine(outbox, () => 1_000);
    const result = await engine.flush(BIZ_A, async () => { throw new Error("Failed to fetch"); });
    expect(result.failed).toBe(1);
    expect(result.stopped).toBe(true);
    const row = await outbox.get(BIZ_A, operationId);
    expect(row?.status).toBe("failed");
    expect(row?.requestId).toBe(requestId);
    expect(row?.nextAttemptAt).toBeGreaterThan(1_000);
  });

  it("marks permanent API errors failed but can continue with an independent operation", async () => {
    const outbox = getOutboxStore();
    const bad = newEntityId();
    const good = newEntityId();
    await outbox.enqueue({ operationId: bad, businessId: BIZ_A, entity: "expense", operation: "create", requestId: newRequestId(), payload: {}, localCreatedAt: 100 });
    await outbox.enqueue({ operationId: good, businessId: BIZ_A, entity: "expense", operation: "create", requestId: newRequestId(), payload: {}, localCreatedAt: 200 });
    const sent: string[] = [];
    const result = await new OutboxSyncEngine(outbox, () => 10_000).flush(BIZ_A, async (item) => {
      sent.push(item.operationId);
      if (item.operationId === bad) throw new ApiError("VALIDATION", "Bad", 400);
      return { remoteId: newEntityId() };
    });
    expect(result.failed).toBe(1);
    expect(result.synced).toBe(1);
    expect(sent).toEqual([bad, good]);
  });

  it("does not send a child whose dependency is not synced", async () => {
    const outbox = getOutboxStore();
    const parent = newEntityId();
    const child = newEntityId();
    await outbox.enqueue({ operationId: child, businessId: BIZ_A, entity: "sale", operation: "create", requestId: newRequestId(), payload: {}, dependsOn: [parent] });
    const result = await new OutboxSyncEngine(outbox, () => 10_000).flush(BIZ_A, async () => ({ remoteId: newEntityId() }));
    expect(result.synced).toBe(0);
    expect(result.blocked).toBe(1);
  });
});

describe("M6.4 ConnectivityMonitor", () => {
  it("is safe outside the browser and supports subscriptions", () => {
    const monitor = new ConnectivityMonitor();
    expect(typeof monitor.online).toBe("boolean");
    const events: boolean[] = [];
    const unsubscribe = monitor.subscribe((online) => events.push(online));
    unsubscribe();
    monitor.start();
    monitor.stop();
  });
});
