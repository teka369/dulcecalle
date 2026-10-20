import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { __resetLocalDbForTests, getLocalDb } from "./db";
import { newEntityId, newRequestId } from "./ids";
import { getOutboxStore, OutboxSyncEngine, resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "./outbox";
import { resetLocalStoreSingleton } from "./store";
import { discardOutboxOperation, listEnrichedTray, retryOutboxOperation } from "../pwa/sync-tray";

/**
 * loop/v1 T-alto2: a child whose parent was discarded must not stay pending
 * forever. It must say what it was waiting for and offer Reintentar/Descartar.
 */
const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function seedParentChild() {
  const outbox = getOutboxStore();
  const parent = newEntityId();
  const child = newEntityId();
  const grandchild = newEntityId();
  await outbox.enqueue({ operationId: parent, businessId: BIZ, entity: "cashSession", operation: "open", requestId: newRequestId(), payload: { openingFloat: 0 }, localCreatedAt: 100 });
  await outbox.enqueue({ operationId: child, businessId: BIZ, entity: "cashMove", operation: "create", requestId: newRequestId(), payload: { amount: 5000 }, dependsOn: [parent], localCreatedAt: 200 });
  await outbox.enqueue({ operationId: grandchild, businessId: BIZ, entity: "expense", operation: "create", requestId: newRequestId(), payload: {}, dependsOn: [child], localCreatedAt: 300 });
  return { outbox, parent, child, grandchild };
}

describe("outbox: dependents of a discarded operation (T-alto2)", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });
  afterEach(async () => {
    resetOutboxStoreSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("parent fails permanently → discard → child needs attention with «Esperando a …», no longer blocked forever", async () => {
    const { outbox, parent, child, grandchild } = await seedParentChild();
    const engine = new OutboxSyncEngine(outbox, () => 10_000);
    await engine.flush(BIZ, async (item) => {
      if (item.operationId === parent) throw new ApiError("CONFLICT", "Ya hay una caja abierta hoy.", 409);
      return { remoteId: newEntityId() };
    });
    expect((await outbox.get(BIZ, child))?.status).toBe("pending");

    await discardOutboxOperation(BIZ, parent);

    const row = await outbox.get(BIZ, child);
    expect(row?.status).toBe("failed");
    expect(row?.nextAttemptAt).toBeNull();
    expect(row?.lastError).toMatch(/Esperando a Apertura de caja/);
    expect(row?.dependsOn).not.toContain(parent);

    const tray = await listEnrichedTray(BIZ);
    const item = tray.find((t) => t.operationId === child)!;
    expect(item.permanent).toBe(true); // → Reintentar / Descartar in the UI
    expect(item.blockedBy).toBeNull();

    // The grandchild is untouched: still waiting on its (existing) parent.
    const g = await outbox.get(BIZ, grandchild);
    expect(g?.status).toBe("pending");
    expect(g?.dependsOn).toEqual([child]);
    expect(tray.find((t) => t.operationId === grandchild)?.blockedBy).toBe("Esperando a «Movimiento de caja», que el servidor rechazó. Corrígela o descártala.");

    // Reintentar sends the child (same requestId) without the discarded parent.
    await retryOutboxOperation(BIZ, child);
    const sent: string[] = [];
    await engine.flush(BIZ, async (it) => {
      sent.push(it.operationId);
      return { remoteId: newEntityId() };
    });
    expect(sent).toEqual([child, grandchild]);
  });

  it("legacy orphan (pending child whose dependency row is gone) says why and is actionable", async () => {
    const { outbox, parent, child } = await seedParentChild();
    await getLocalDb().outbox.delete(parent); // what the old discard left behind
    const tray = await listEnrichedTray(BIZ);
    const item = tray.find((t) => t.operationId === child)!;
    expect(item.status).toBe("pending");
    expect(item.blockedBy).toMatch(/Esperando a una operación que se descartó/);
    expect(item.orphaned).toBe(true);
    void outbox;
  });

  it("normal path unchanged: parent then child, both synced in order", async () => {
    const { outbox, parent, child, grandchild } = await seedParentChild();
    const sent: string[] = [];
    const result = await new OutboxSyncEngine(outbox, () => 10_000).flush(BIZ, async (it) => {
      sent.push(it.operationId);
      return { remoteId: newEntityId() };
    });
    expect(result).toMatchObject({ synced: 3, failed: 0, blocked: 0 });
    expect(sent).toEqual([parent, child, grandchild]);
  });

  it("discarding an operation with no dependents is unchanged", async () => {
    const outbox = getOutboxStore();
    const op = newEntityId();
    await outbox.enqueue({ operationId: op, businessId: BIZ, entity: "expense", operation: "create", requestId: newRequestId(), payload: {} });
    await discardOutboxOperation(BIZ, op);
    expect(await outbox.get(BIZ, op)).toBeUndefined();
  });
});
