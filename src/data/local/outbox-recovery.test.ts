import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetLocalDbForTests } from "@/data/local/db";
import {
  OutboxSyncEngine,
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "./outbox";
import { newEntityId } from "./ids";
import { newRequestId } from "@/domain/requestId";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER_BIZ = "22222222-2222-4222-8222-222222222222";

async function seedFailedPermanent() {
  const outbox = getOutboxStore();
  const operationId = newEntityId();
  const requestId = newRequestId();
  await outbox.enqueue({
    operationId,
    businessId: BIZ,
    entity: "sale",
    operation: "create",
    requestId,
    payload: {},
  });
  await outbox.markInFlight(BIZ, operationId);
  await outbox.markFailed(BIZ, operationId, "VALIDATION", null);
  return { operationId, requestId };
}

describe("M6.9 outbox recovery", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    await __resetLocalDbForTests();
  });

  it("Test 1: a permanent failed operation is not resent automatically", async () => {
    const { operationId } = await seedFailedPermanent();
    let sent = 0;
    const result = await new OutboxSyncEngine(getOutboxStore(), () => 10_000).flush(
      BIZ,
      async () => {
        sent += 1;
        return { remoteId: newEntityId() };
      },
    );
    expect(sent).toBe(0);
    expect(result.processed).toBe(0);
    expect((await getOutboxStore().get(BIZ, operationId))?.status).toBe("failed");
  });

  it("Test 2: retry moves failed back to a processable state", async () => {
    const { operationId } = await seedFailedPermanent();
    const row = await getOutboxStore().requeue(BIZ, operationId);
    expect(row.status).toBe("pending");
    expect(row.nextAttemptAt).toBeNull();
  });

  it("Test 3: retry keeps exactly the same requestId", async () => {
    const { operationId, requestId } = await seedFailedPermanent();
    const row = await getOutboxStore().requeue(BIZ, operationId);
    expect(row.requestId).toBe(requestId);
    expect(row.operationId).toBe(operationId);
  });

  it("Test 4: a retried operation flows normally with the stored requestId", async () => {
    const { operationId, requestId } = await seedFailedPermanent();
    await getOutboxStore().requeue(BIZ, operationId);
    const seen: string[] = [];
    const result = await new OutboxSyncEngine(getOutboxStore(), () => 10_000).flush(
      BIZ,
      async (item) => {
        seen.push(item.requestId);
        return { remoteId: newEntityId() };
      },
    );
    expect(result.synced).toBe(1);
    expect(seen).toEqual([requestId]);
    expect((await getOutboxStore().get(BIZ, operationId))?.status).toBe("synced");
  });

  it("Test 5: discard removes the operation", async () => {
    const { operationId } = await seedFailedPermanent();
    await getOutboxStore().discard(BIZ, operationId);
    expect(await getOutboxStore().get(BIZ, operationId)).toBeUndefined();
  });

  it("Test 6: a discarded operation never runs again", async () => {
    const { operationId } = await seedFailedPermanent();
    await getOutboxStore().discard(BIZ, operationId);
    let sent = 0;
    await new OutboxSyncEngine(getOutboxStore(), () => 10_000).flush(BIZ, async () => {
      sent += 1;
      return { remoteId: newEntityId() };
    });
    expect(sent).toBe(0);
    expect(await getOutboxStore().get(BIZ, operationId)).toBeUndefined();
  });

  it("Test 7: normal pending operations keep working", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    await outbox.enqueue({
      operationId,
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    const result = await new OutboxSyncEngine(outbox, () => 10_000).flush(
      BIZ,
      async () => ({ remoteId: newEntityId() }),
    );
    expect(result.synced).toBe(1);
  });

  it("Test 8: in_flight recovery keeps its previous behavior", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    const requestId = newRequestId();
    await outbox.enqueue({
      operationId,
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId,
      payload: {},
    });
    await outbox.markInFlight(BIZ, operationId);
    const seen: string[] = [];
    const result = await new OutboxSyncEngine(outbox, () => 10_000).flush(
      BIZ,
      async (item) => {
        seen.push(item.requestId);
        return { remoteId: newEntityId() };
      },
    );
    expect(result.synced).toBe(1);
    expect(seen).toEqual([requestId]);
  });

  it("scheduled failed retries still flush automatically when due", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    await outbox.enqueue({
      operationId,
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    await outbox.markInFlight(BIZ, operationId);
    await outbox.markFailed(BIZ, operationId, "NetworkError", 5_000);
    const result = await new OutboxSyncEngine(outbox, () => 10_000).flush(
      BIZ,
      async () => ({ remoteId: newEntityId() }),
    );
    expect(result.synced).toBe(1);
  });

  it("future scheduled retries are skipped until due", async () => {
    const outbox = getOutboxStore();
    const operationId = newEntityId();
    await outbox.enqueue({
      operationId,
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    await outbox.markInFlight(BIZ, operationId);
    await outbox.markFailed(BIZ, operationId, "NetworkError", 50_000);
    let sent = 0;
    await new OutboxSyncEngine(outbox, () => 10_000).flush(BIZ, async () => {
      sent += 1;
      return { remoteId: newEntityId() };
    });
    expect(sent).toBe(0);
  });

  it("retry and discard enforce status and tenant guards", async () => {
    const outbox = getOutboxStore();
    const pending = newEntityId();
    await outbox.enqueue({
      operationId: pending,
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    await expect(outbox.requeue(BIZ, pending)).rejects.toThrow("only failed");
    await expect(outbox.requeue(OTHER_BIZ, pending)).rejects.toThrow("another business");
    await outbox.markInFlight(BIZ, pending);
    await outbox.markSynced(BIZ, pending, newEntityId());
    await expect(outbox.discard(BIZ, pending)).rejects.toThrow("only pending/failed");
    await expect(outbox.discard(OTHER_BIZ, pending)).rejects.toThrow("another business");
  });
});
