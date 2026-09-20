import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetLocalDbForTests } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { newEntityId } from "@/data/local/ids";
import { newRequestId } from "@/domain/requestId";
import {
  describeOutboxOperation,
  describeTrayStatus,
  discardOutboxOperation,
  listTrayOperations,
  retryOutboxOperation,
} from "./sync-tray";

const BIZ = "11111111-1111-4111-8111-111111111111";

describe("M6.9 sync tray helpers", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    await __resetLocalDbForTests();
  });

  async function seedTray() {
    const outbox = getOutboxStore();
    const pending = newEntityId();
    await outbox.enqueue({
      operationId: pending,
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
      localCreatedAt: 100,
    });
    const failed = newEntityId();
    const failedRequestId = newRequestId();
    await outbox.enqueue({
      operationId: failed,
      businessId: BIZ,
      entity: "customerPayment",
      operation: "pay",
      requestId: failedRequestId,
      payload: {},
      localCreatedAt: 200,
    });
    await outbox.markInFlight(BIZ, failed);
    await outbox.markFailed(BIZ, failed, "El abono no puede ser mayor al saldo.", null);
    const done = newEntityId();
    await outbox.enqueue({
      operationId: done,
      businessId: BIZ,
      entity: "expense",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
      localCreatedAt: 300,
    });
    await outbox.markInFlight(BIZ, done);
    await outbox.markSynced(BIZ, done, newEntityId());
    return { pending, failed, failedRequestId, done };
  }

  it("lists failed and pending, never synced, oldest first", async () => {
    const { pending, failed } = await seedTray();
    const items = await listTrayOperations(BIZ);
    expect(items.map((i) => i.operationId)).toEqual([pending, failed]);
    expect(items.find((i) => i.operationId === failed)?.lastError).toContain(
      "mayor al saldo",
    );
    expect(items.find((i) => i.operationId === failed)?.requestId).toBeTruthy();
  });

  it("retry makes a failed item processable with the same requestId", async () => {
    const { failed, failedRequestId } = await seedTray();
    const item = await retryOutboxOperation(BIZ, failed);
    expect(item.status).toBe("pending");
    expect(item.requestId).toBe(failedRequestId);
    const items = await listTrayOperations(BIZ);
    expect(items.find((i) => i.operationId === failed)?.status).toBe("pending");
  });

  it("discard removes the item from the tray", async () => {
    const { failed } = await seedTray();
    await discardOutboxOperation(BIZ, failed);
    const items = await listTrayOperations(BIZ);
    expect(items.some((i) => i.operationId === failed)).toBe(false);
    expect(items).toHaveLength(1);
  });

  it("describes operations and statuses for the UI", async () => {
    expect(describeOutboxOperation("sale", "create")).toBe("Venta");
    expect(describeOutboxOperation("customerPayment", "pay")).toBe("Abono de cliente");
    expect(describeOutboxOperation("supplier", "create")).toBe("Proveedor nuevo");
    expect(describeTrayStatus("failed")).toBe("Error");
    expect(describeTrayStatus("pending")).toBe("Pendiente");
    expect(describeTrayStatus("in_flight")).toBe("Sincronizando");
  });
});
