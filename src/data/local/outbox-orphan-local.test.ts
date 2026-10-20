import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../errors";
import { __resetLocalDbForTests, getLocalDb } from "./db";
import { newEntityId, newRequestId } from "./ids";
import { getOutboxStore, OutboxSyncEngine, resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "./outbox";
import { resetLocalStoreSingleton } from "./store";
import { discardOutboxOperation, listEnrichedTray } from "../pwa/sync-tray";

/**
 * loop/v1 T-alto2 follow-up: a child that references its discarded parent's
 * LOCAL id can never be sent → only Descartar, with the reason. A child that
 * does not reference it keeps Reintentar + Descartar. Legacy orphans: decide
 * when possible, otherwise the safe option (only Descartar) and say so.
 */
const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function failParentPermanently(parent: string) {
  await new OutboxSyncEngine(getOutboxStore(), () => 10_000).flush(BIZ, async (item) => {
    if (item.operationId === parent) throw new ApiError("VALIDATION", "Datos inválidos.", 400);
    return { remoteId: newEntityId() };
  });
}

async function trayItem(operationId: string) {
  return (await listEnrichedTray(BIZ)).find((t) => t.operationId === operationId)!;
}

describe("orphaned children: Reintentar only when it can work", () => {
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

  it("sale referencing the discarded customer's local id → only Descartar, explains why", async () => {
    const outbox = getOutboxStore();
    const parent = newEntityId();
    const parentKey = newRequestId();
    const localCustomerId = newEntityId();
    await getLocalDb().customers.put({
      id: localCustomerId, businessId: BIZ, code: null, name: "Rosa", phone: null, debt: 0, archivedAt: null,
      requestId: parentKey, createdAt: 1, updatedAt: 1,
    } as never);
    await outbox.enqueue({ operationId: parent, businessId: BIZ, entity: "customer", operation: "create", requestId: parentKey, payload: { name: "Rosa" }, localCreatedAt: 100 });
    const child = newEntityId();
    await outbox.enqueue({ operationId: child, businessId: BIZ, entity: "sale", operation: "create", requestId: newRequestId(), payload: { customerId: localCustomerId, lines: [] }, dependsOn: [parent], localCreatedAt: 200 });
    await failParentPermanently(parent);
    await discardOutboxOperation(BIZ, parent);

    const item = await trayItem(child);
    expect(item.status).toBe("failed");
    expect(item.canRetry).toBe(false);
    expect(item.orphanNote).toMatch(/Dependía de «Cliente nuevo», que se descartó y nunca llegó al servidor/);
    expect(item.orphanNote).toMatch(/Descártalo y vuelve a crearlo/);
  });

  it("close referencing the discarded open's local session id (operationId) → only Descartar", async () => {
    const outbox = getOutboxStore();
    const session = newEntityId();
    await outbox.enqueue({ operationId: session, businessId: BIZ, entity: "cashSession", operation: "open", requestId: newRequestId(), payload: { openingFloat: 0 }, localCreatedAt: 100 });
    const child = newEntityId();
    await outbox.enqueue({ operationId: child, businessId: BIZ, entity: "cashSession", operation: "close", requestId: newRequestId(), payload: { sessionId: session, countedEfectivo: 0 }, dependsOn: [session], localCreatedAt: 200 });
    await failParentPermanently(session);
    await discardOutboxOperation(BIZ, session);
    const item = await trayItem(child);
    expect(item.canRetry).toBe(false);
    expect(item.orphanNote).toMatch(/«Apertura de caja».*nunca llegó al servidor/);
  });

  it("aporte that does NOT reference the discarded open → Reintentar + Descartar", async () => {
    const outbox = getOutboxStore();
    const session = newEntityId();
    await outbox.enqueue({ operationId: session, businessId: BIZ, entity: "cashSession", operation: "open", requestId: newRequestId(), payload: { openingFloat: 0 }, localCreatedAt: 100 });
    const child = newEntityId();
    await outbox.enqueue({ operationId: child, businessId: BIZ, entity: "cashMove", operation: "create", requestId: newRequestId(), payload: { kind: "aporte", amount: 5000, method: "Efectivo" }, dependsOn: [session], localCreatedAt: 200 });
    await failParentPermanently(session);
    await discardOutboxOperation(BIZ, session);
    const item = await trayItem(child);
    expect(item.permanent).toBe(true);
    expect(item.canRetry).toBe(true);
    expect(item.lastError).toMatch(/Esperando a Apertura de caja/);
  });

  it("legacy orphan whose payload holds the missing dependency id → only Descartar (determined)", async () => {
    const outbox = getOutboxStore();
    const missing = newEntityId();
    const child = newEntityId();
    await outbox.enqueue({ operationId: child, businessId: BIZ, entity: "cashSession", operation: "close", requestId: newRequestId(), payload: { sessionId: missing }, dependsOn: [missing], localCreatedAt: 200 });
    const item = await trayItem(child);
    expect(item.orphaned).toBe(true);
    expect(item.canRetry).toBe(false);
    expect(item.orphanNote).toMatch(/nunca llegó al servidor/);
  });

  it("legacy orphan that cannot be determined → safe option: only Descartar, and says so", async () => {
    const outbox = getOutboxStore();
    const child = newEntityId();
    await outbox.enqueue({ operationId: child, businessId: BIZ, entity: "cashMove", operation: "create", requestId: newRequestId(), payload: { kind: "aporte", amount: 5000, method: "Efectivo" }, dependsOn: [newEntityId()], localCreatedAt: 200 });
    const item = await trayItem(child);
    expect(item.orphaned).toBe(true);
    expect(item.canRetry).toBe(false);
    expect(item.orphanNote).toMatch(/No podemos confirmar/);
  });

  it("ordinary failures keep Reintentar", async () => {
    const outbox = getOutboxStore();
    const op = newEntityId();
    await outbox.enqueue({ operationId: op, businessId: BIZ, entity: "expense", operation: "create", requestId: newRequestId(), payload: {}, localCreatedAt: 100 });
    await failParentPermanently(op);
    const item = await trayItem(op);
    expect(item.canRetry).toBe(true);
    expect(item.orphanNote).toBeNull();
  });
});
