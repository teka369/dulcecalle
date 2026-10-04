import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal window/event bus: node environment has none. Installed before
// any store interaction so the real listeners attach to it.
const eventListeners = new Map<string, Set<(event: Event) => void>>();
function installWindowStub() {
  if (typeof (globalThis as Record<string, unknown>).window === "object") return;
  vi.stubGlobal("window", {
    addEventListener: (type: string, listener: (event: Event) => void) => {
      const set = eventListeners.get(type) ?? new Set();
      set.add(listener);
      eventListeners.set(type, set);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      eventListeners.get(type)?.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      eventListeners.get(event.type)?.forEach((l) => l(event));
      return true;
    },
    setTimeout: (...args: [Parameters<typeof setTimeout>[0], number]) =>
      setTimeout(args[0], args[1]),
    clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout),
  });
  vi.stubGlobal("navigator", { onLine: true });
}
installWindowStub();
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { newEntityId } from "@/data/local/ids";
import { newRequestId } from "@/domain/requestId";
import {
  describeOutboxDetail,
  humanizeSyncError,
  isPermanentFailure,
  isRetryableFailure,
  resolveBlockedReason,
} from "./sync-tray";
import { syncPillLabel } from "@/components/shell/SyncPill";
import {
  DISCARD_NOTICE,
  formatSyncWhen,
  lastCompletedSyncLine,
  syncOperationNotes,
  syncPillLabel as pillFromCopy,
  syncPlaceCopy,
} from "@/data/pwa/sync-copy";
import { __clearLastCompletedSyncForTests, readLastCompletedSync } from "@/data/pwa/last-completed-sync";
import { getPwaAuthSession } from "@/data/http/session";
import { __resetSyncUiForTests, syncStore } from "@/store/syncStore";

const BIZ = "11111111-1111-4111-8111-111111111111";

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function counts(total = 0, permanent = 0) {
  return { pending: total, active: 0, failed: permanent, permanent, total };
}

describe("sync UX: pill labels match real states", () => {
  it("shows where the work is, without calling it a backup", () => {
    expect(syncPillLabel(true, counts(0), null)).toBe("✓ En el servidor");
    expect(syncPillLabel(true, counts(1), null)).toBe("1 guardada aquí");
    expect(syncPillLabel(true, counts(3), null)).toBe("3 guardadas aquí");
    expect(syncPillLabel(true, counts(5), { completed: 2, total: 5 })).toBe(
      "↑ Enviando 2 de 5",
    );
    expect(syncPillLabel(true, counts(2, 1), null)).toBe("! 1 necesita atención");
    expect(syncPillLabel(true, counts(2, 2), null)).toBe("! 2 necesitan atención");
    expect(syncPillLabel(false, counts(2), null)).toBe("○ Sin conexión · 2 guardadas aquí");
    expect(syncPillLabel(false, counts(0), null)).toBe("○ Sin conexión");
    expect(syncPillLabel(true, counts(1), null, true)).toBe("Entra para enviar lo guardado aquí");
    for (const label of [
      syncPillLabel(true, counts(0), null),
      syncPillLabel(false, counts(2), null),
      syncPillLabel(true, counts(1), null),
    ]) {
      expect(label.toLowerCase()).not.toMatch(/respald|seguros|copia de seguridad/);
    }
    expect(pillFromCopy(true, counts(0), null)).toBe("✓ En el servidor");
  });
});

describe("sync UX: copy never pretends a backup or a finished send", () => {
  const now = new Date(2026, 9, 4, 15, 0).getTime();

  it("formats today and older days with the app clock", () => {
    const today = new Date(2026, 9, 4, 14, 2).getTime();
    expect(formatSyncWhen(today, now)).toBe("hoy 14:02");
    const yesterday = new Date(2026, 9, 3, 9, 5).getTime();
    expect(formatSyncWhen(yesterday, now)).toBe("03/10/2026 09:05");
  });

  it("does not invent a time, and does not call a dirty queue fully sent", () => {
    expect(lastCompletedSyncLine(null, true, now)).toBe("Aún no hay un envío registrado");
    expect(lastCompletedSyncLine(null, false, now)).toBe("Aún no hay un envío registrado");
    const at = new Date(2026, 9, 4, 14, 2).getTime();
    expect(lastCompletedSyncLine(at, true, now)).toBe("Último envío: hoy 14:02");
    expect(lastCompletedSyncLine(at, false, now)).toBe("Último envío completo: hoy 14:02");
  });

  it("separates server, device and attention", () => {
    const clear = syncPlaceCopy({
      online: true,
      authRequired: false,
      flushing: null,
      counts: counts(0),
    });
    expect(clear.server).toMatch(/No hay operaciones pendientes/);
    expect(clear.lead.toLowerCase()).not.toMatch(/respald|seguros/);
    const offline = syncPlaceCopy({
      online: false,
      authRequired: false,
      flushing: null,
      counts: counts(2),
    });
    expect(offline.lead).toMatch(/no se ha perdido/i);
    expect(offline.lead).toMatch(/todavía no está en el servidor/i);
    const attention = syncPlaceCopy({
      online: true,
      authRequired: false,
      flushing: null,
      counts: counts(2, 1),
    });
    expect(attention.attention).toMatch(/no se enviará sola/);
    expect(attention.device).toMatch(/1 operación guardada/);
  });

  it("does not show requestId in the sync screens", () => {
    const files = [
      "src/components/shell/sync-items.tsx",
      "src/components/shell/SyncCenter.tsx",
      "src/components/shell/SyncPill.tsx",
      "src/components/shell/SyncStatusSummary.tsx",
      "src/app/sincronizacion/page.tsx",
      "src/app/offline/page.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/requestId/);
      expect(src.toLowerCase()).not.toMatch(/respaldado|están seguros|copia de seguridad actualizada/);
    }
  });

  it("hides technical ids from the notes the row shows", () => {
    const notes = syncOperationNotes({
      status: "failed",
      localCreatedAt: new Date(2026, 9, 4, 14, 2).getTime(),
      attempts: 2,
      nextAttemptAt: null,
    });
    expect(notes.join(" ")).not.toMatch(/requestId/i);
    expect(notes.join(" ")).toMatch(/No se enviará sola/);
    expect(DISCARD_NOTICE).toMatch(/No deshace nada/);
    expect(DISCARD_NOTICE).toMatch(/seguir apareciendo/);
    expect(DISCARD_NOTICE.toLowerCase()).not.toMatch(/requestid/);
  });
});

describe("sync UX: operation details from real payloads", () => {
  it("describes sale, payment, expense, cash, stock and catalog ops", () => {
    const saleDetail = describeOutboxDetail({
      entity: "sale",
      operation: "create",
      payload: { lines: [{ qty: 2 }, { qty: 1 }], paymentKind: "paid", amountReceived: 1500 },
    });
    expect(saleDetail).toContain("2 productos");
    expect(saleDetail).toContain("3 uds");
    expect(saleDetail).toContain("Pagada");
    expect(saleDetail).toContain("1.500");
    expect(
      describeOutboxDetail({
        entity: "customerPayment",
        operation: "pay",
        payload: { amount: 1000, method: "Efectivo" },
      }),
    ).toContain("1.000");
    const expenseDetail = describeOutboxDetail({
      entity: "expense",
      operation: "create",
      payload: { amount: 2000, category: "Luz" },
    });
    expect(expenseDetail).toContain("Luz");
    expect(expenseDetail).toContain("2.000");
    expect(
      describeOutboxDetail({
        entity: "stockMove",
        operation: "surtir",
        payload: { qty: 20, totalCost: 0 },
      }),
    ).toBe("20 uds");
    expect(
      describeOutboxDetail({
        entity: "customer",
        operation: "create",
        payload: { name: "Rosa" },
      }),
    ).toBe("Rosa");
    expect(
      describeOutboxDetail({ entity: "sale", operation: "create", payload: { nope: 1 } }),
    ).toBe("0 productos · Pagada");
    expect(describeOutboxDetail({ entity: "sale", operation: "create", payload: null })).toBeNull();
  });

  it("humanizes transport noise but keeps server messages", () => {
    expect(humanizeSyncError(new NetworkError().message)).toContain("conexión");
    expect(humanizeSyncError("Failed to fetch")).toContain("conexión");
    expect(humanizeSyncError("La caja de hoy ya está cerrada.")).toBe(
      "La caja de hoy ya está cerrada.",
    );
    expect(humanizeSyncError(null)).toBeNull();
  });

  it("distinguishes permanent from retryable failures", () => {
    expect(isPermanentFailure({ status: "failed", nextAttemptAt: null })).toBe(true);
    expect(isPermanentFailure({ status: "failed", nextAttemptAt: 999 })).toBe(false);
    expect(isRetryableFailure({ status: "failed", nextAttemptAt: 999 })).toBe(true);
    expect(isRetryableFailure({ status: "pending", nextAttemptAt: null })).toBe(false);
  });
});

describe("sync UX: store reflects Dexie truth and events", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    __clearLastCompletedSyncForTests();
    __resetSyncUiForTests();
    getPwaAuthSession().businessId = BIZ;
    syncStore.subscribe(() => {});
    await syncStore.refresh();
    vi.clearAllMocks();
  });

  it("counts pending/failed/permanent from the outbox", async () => {
    const outbox = getOutboxStore();
    const op = newEntityId();
    await outbox.enqueue({
      operationId: op,
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    const bad = newEntityId();
    await outbox.enqueue({
      operationId: bad,
      businessId: BIZ,
      entity: "expense",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    await outbox.markInFlight(BIZ, bad);
    await outbox.markFailed(BIZ, bad, "Día cerrado", null);
    await syncStore.refresh();
    const snap = syncStore.getSnapshot();
    expect(snap.counts.pending).toBe(1);
    expect(snap.counts.failed).toBe(1);
    expect(snap.counts.permanent).toBe(1);
    expect(snap.counts.total).toBe(2);
  });

  it("aggregates start/item/done events into honest progress", async () => {
    const fire = (detail: Record<string, unknown>) =>
      window.dispatchEvent(new CustomEvent("dulcecalle:sync", { detail }));
    fire({ type: "start", businessId: BIZ, total: 3 });
    fire({ type: "item", businessId: BIZ, entity: "sale", operation: "create", status: "synced", completed: 1, total: 3 });
    // second sequential flush joins the same cycle instead of resetting
    fire({ type: "start", businessId: BIZ, total: 2 });
    fire({ type: "item", businessId: BIZ, entity: "expense", operation: "create", status: "synced", completed: 1, total: 2 });
    expect(syncStore.getSnapshot().flushing).toEqual({ completed: 2, total: 5 });
    fire({ type: "done", businessId: BIZ, result: { processed: 2, synced: 2, failed: 0, blocked: 0, stopped: false } });
    fire({ type: "done", businessId: BIZ, result: { processed: 0, synced: 0, failed: 0, blocked: 0, stopped: false } });
    const snap = syncStore.getSnapshot();
    expect(snap.flushing).toBeNull();
    expect(snap.lastResult?.synced).toBe(0);
    await settle();
    expect(syncStore.getSnapshot().lastDoneAt).toBeGreaterThan(0);
  });

  it("remembers a clean cycle per business and ignores a dirty one", async () => {
    const fire = (detail: Record<string, unknown>) =>
      window.dispatchEvent(new CustomEvent("dulcecalle:sync", { detail }));
    expect(syncStore.getSnapshot().lastDoneAt).toBeNull();
    fire({
      type: "done",
      businessId: BIZ,
      result: { processed: 1, synced: 1, failed: 0, blocked: 0, stopped: false },
    });
    await settle();
    const at = syncStore.getSnapshot().lastDoneAt;
    expect(at).toBeGreaterThan(0);
    expect(readLastCompletedSync(BIZ)).toBe(at);

    __resetSyncUiForTests();
    await syncStore.refresh();
    expect(syncStore.getSnapshot().lastDoneAt).toBe(at);

    const other = "22222222-2222-4222-8222-222222222222";
    getPwaAuthSession().businessId = other;
    __resetSyncUiForTests();
    await syncStore.refresh();
    expect(syncStore.getSnapshot().lastDoneAt).toBeNull();
    expect(readLastCompletedSync(other)).toBeNull();

    getPwaAuthSession().businessId = BIZ;
    await syncStore.refresh();
    expect(syncStore.getSnapshot().lastDoneAt).toBe(at);

    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    fire({
      type: "done",
      businessId: BIZ,
      result: { processed: 1, synced: 0, failed: 1, blocked: 0, stopped: true },
    });
    await settle();
    expect(readLastCompletedSync(BIZ)).toBe(at);
    expect(syncStore.getSnapshot().lastDoneAt).toBe(at);
    expect(syncStore.getSnapshot().counts.total).toBeGreaterThan(0);
  });

  it("does not store a clock when the queue is still pending", async () => {
    const fire = (detail: Record<string, unknown>) =>
      window.dispatchEvent(new CustomEvent("dulcecalle:sync", { detail }));
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "product",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    fire({
      type: "done",
      businessId: BIZ,
      result: { processed: 1, synced: 1, failed: 0, blocked: 0, stopped: false },
    });
    await settle();
    expect(readLastCompletedSync(BIZ)).toBeNull();
    expect(syncStore.getSnapshot().lastDoneAt).toBeNull();
  });

  it("ignores events from another business", async () => {
    const fire = (detail: Record<string, unknown>) =>
      window.dispatchEvent(new CustomEvent("dulcecalle:sync", { detail }));
    fire({ type: "start", businessId: "22222222-2222-4222-8222-222222222222", total: 9 });
    expect(syncStore.getSnapshot().flushing).toBeNull();
  });

  it("enqueueing offline bumps the counts without any flush", async () => {
    await syncStore.refresh();
    expect(syncStore.getSnapshot().counts.total).toBe(0);
    await getOutboxStore().enqueue({
      operationId: newEntityId(),
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(syncStore.getSnapshot().counts.pending).toBe(1);
  });

  it("resolves blocked reasons from real dependencies", async () => {
    const outbox = getOutboxStore();
    const parent = newEntityId();
    await outbox.enqueue({
      operationId: parent,
      businessId: BIZ,
      entity: "supplier",
      operation: "create",
      requestId: newRequestId(),
      payload: {},
    });
    const child = newEntityId();
    await outbox.enqueue({
      operationId: child,
      businessId: BIZ,
      entity: "stockMove",
      operation: "surtir",
      requestId: newRequestId(),
      payload: {},
      dependsOn: [parent],
    });
    const item = await outbox.get(BIZ, child);
    expect(await resolveBlockedReason(BIZ, { dependsOn: item!.dependsOn })).toBe(
      "Esperando proveedor",
    );
    expect(await resolveBlockedReason(BIZ, { dependsOn: [] })).toBeNull();
  });
});
