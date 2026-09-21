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
import { getPwaAuthSession } from "@/data/http/session";
import { syncStore } from "@/store/syncStore";

const BIZ = "11111111-1111-4111-8111-111111111111";

function counts(total = 0, permanent = 0) {
  return { pending: total, active: 0, failed: permanent, permanent, total };
}

describe("sync UX: pill labels match real states", () => {
  it("shows synced when idle, pending counts, progress and errors", () => {
    expect(syncPillLabel(true, counts(0), null)).toBe("✓ Sincronizado");
    expect(syncPillLabel(true, counts(1), null)).toBe("1 pendiente");
    expect(syncPillLabel(true, counts(3), null)).toBe("3 pendientes");
    expect(syncPillLabel(true, counts(5), { completed: 2, total: 5 })).toBe(
      "↻ Sincronizando 2/5",
    );
    expect(syncPillLabel(true, counts(2, 1), null)).toBe("! 1 necesita atención");
    expect(syncPillLabel(false, counts(2), null)).toBe("○ Sin conexión · 2 pendientes");
    expect(syncPillLabel(false, counts(0), null)).toBe("○ Sin conexión");
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
    getPwaAuthSession().businessId = BIZ;
    syncStore.subscribe(() => {});
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
    expect(snap.lastDoneAt).toBeGreaterThan(0);
    expect(snap.lastResult?.synced).toBe(0);
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
