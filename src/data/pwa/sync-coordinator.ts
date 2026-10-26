import { navDebug } from "./nav-debug";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { ConnectivityMonitor, getOutboxStore, getOutboxSyncEngine, type SyncFlushResult } from "../local/outbox";
import type { OutboxItem } from "../local/types";
import { syncPendingCustomers, syncPendingProducts, syncPendingSuppliers } from "./offline-catalog";
import { syncPendingProductImages } from "./product-images";
import { syncPendingPreparations } from "./offline-production";
import { syncPendingOperations } from "./offline-operations";
import { syncPendingPayments } from "./offline-payments";
import { syncPendingInitialDebts } from "./offline-initial-debt";
import { syncPendingSales } from "./offline-sales";
import { syncPendingReturns } from "./offline-returns";
import { openSyncChannel, runAsLeader, type SyncBroadcast } from "./sync-leader";

export type SyncAllResult = {
  sales: SyncFlushResult;
  returns: SyncFlushResult;
  payments: SyncFlushResult;
  initialDebts: SyncFlushResult;
  customers: SyncFlushResult;
  suppliers: SyncFlushResult;
  products: SyncFlushResult;
  images: SyncFlushResult;
  preparations: SyncFlushResult;
  operations: SyncFlushResult;
};

/**
 * D1 — Single outbox coordinator.
 *
 * Every pending type is flushed sequentially inside one cycle, so a single
 * connectivity event drains sales, payments, catalog creates and cash /
 * inventory / expense operations. Sequential awaits never collide on the
 * engine `active` map; concurrent triggers are still serialized per
 * businessId by the engine and stay idempotent through the stored
 * requestId. Tenant isolation is unchanged: everything is scoped to the
 * given businessId.
 */
const AUTH_IDLE: SyncFlushResult = {
  processed: 0,
  synced: 0,
  failed: 0,
  blocked: 0,
  stopped: true,
  authRequired: true,
};

type StepKey = keyof SyncAllResult;

/** Which per-type flush owns an outbox op. */
export function stepForItem(item: Pick<OutboxItem, "entity" | "operation">): StepKey | null {
  switch (item.entity) {
    case "sale":
      return "sales";
    case "saleReturn":
      return "returns";
    case "customerPayment":
      return "payments";
    case "customer":
      return "customers";
    case "initialDebt":
      return "initialDebts";
    case "supplier":
      return "suppliers";
    case "product":
      return "products";
    case "productImage":
      return "images";
    case "preparation":
      return "preparations";
    case "cashSession":
    case "cashMove":
    case "expense":
    case "stockMove":
      return "operations";
    default:
      return null;
  }
}

function addFlush(a: SyncFlushResult | undefined, b: SyncFlushResult): SyncFlushResult {
  if (!a) return b;
  return {
    processed: a.processed + b.processed,
    synced: a.synced + b.synced,
    failed: a.failed + b.failed,
    blocked: b.blocked,
    stopped: b.stopped,
    authRequired: b.authRequired,
  };
}

async function replayInOrder(
  businessId: string,
  steps: ReadonlyArray<[StepKey, () => Promise<SyncFlushResult>]>,
  acc: Partial<Record<StepKey, SyncFlushResult>>,
): Promise<"auth" | "stopped" | "done"> {
  const run = new Map(steps);
  const engine = getOutboxSyncEngine();
  const store = getOutboxStore();
  const now = Date.now();
  const queue = [
    ...(await store.listByStatus(businessId, "pending")),
    ...(await store.listByStatus(businessId, "failed")).filter((r) => r.nextAttemptAt != null && r.nextAttemptAt <= now),
  ].sort((a, b) => a.localCreatedAt - b.localCreatedAt || a.operationId.localeCompare(b.operationId));
  for (const item of queue) {
    const step = stepForItem(item);
    const flush = step ? run.get(step) : undefined;
    if (!flush) continue;
    const r = await engine.withOnly(item.operationId, flush);
    acc[step!] = addFlush(acc[step!], r);
    if (r.authRequired) return "auth";
    if (r.stopped) return "stopped";
  }
  return "done";
}

export async function syncAllPending(businessId: string): Promise<SyncAllResult> {
  const result: SyncAllResult = {
    sales: AUTH_IDLE,
    returns: AUTH_IDLE,
    payments: AUTH_IDLE,
    initialDebts: AUTH_IDLE,
    customers: AUTH_IDLE,
    suppliers: AUTH_IDLE,
    products: AUTH_IDLE,
    images: AUTH_IDLE,
    preparations: AUTH_IDLE,
    operations: AUTH_IDLE,
  };
  const steps: Array<[keyof SyncAllResult, () => Promise<SyncFlushResult>]> = [
    ["sales", () => syncPendingSales(businessId)],
    ["returns", () => syncPendingReturns(businessId)],
    ["payments", () => syncPendingPayments(businessId)],
    ["customers", () => syncPendingCustomers(businessId)],
    ["initialDebts", () => syncPendingInitialDebts(businessId)],
    ["suppliers", () => syncPendingSuppliers(businessId)],
    ["products", () => syncPendingProducts(businessId)],
    ["images", () => syncPendingProductImages(businessId)],
    ["preparations", () => syncPendingPreparations(businessId)],
    ["operations", () => syncPendingOperations(businessId)],
  ];
  // FIFO (loop-v1 HIGH): replay the WHOLE outbox in localCreatedAt order
  // (open -> prepare -> sale -> shrink -> close), one op at a time through its
  // own module, so a sale/shrink never reaches the server before the
  // preparation/surtir that gave it stock. A retryable failure or auth stop
  // halts the replay (later ops may depend on it), as the per-type flush did.
  const replayed: Partial<Record<StepKey, SyncFlushResult>> = {};
  const stop = await replayInOrder(businessId, steps, replayed);
  if (stop !== "done") {
    // auth: every key stays AUTH_IDLE except what already ran. Retryable
    // failure: keep FIFO, send nothing after it this cycle.
    for (const [key] of steps) {
      const idle = stop === "auth" ? AUTH_IDLE : { ...AUTH_IDLE, authRequired: false };
      result[key] = replayed[key] ? { ...replayed[key]!, stopped: true, authRequired: stop === "auth" } : idle;
    }
    return result;
  }
  // Housekeeping pass: anything the replay left (blocked, unmapped entity,
  // concurrent flush) goes through the per-type flushes as before.
  for (const [key, run] of steps) {
    const flush = await run();
    result[key] = addFlush(replayed[key], flush);
    if (flush.authRequired) return result;
  }
  // AC4: a preparation queued behind a pending surtir/merma (dependsOn) is
  // blocked on the first pass; operations just synced, so retry once.
  if (result.preparations.blocked > 0) {
    result.preparations = await syncPendingPreparations(businessId);
  }
  return result;
}

export const SYNC_COMPLETE_EVENT = "dulcecalle:sync-complete";

function emitSyncComplete(businessId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SYNC_COMPLETE_EVENT, { detail: { businessId } }));
}

let channel: ReturnType<typeof openSyncChannel> = null;
let leading = 0;

function post(message: SyncBroadcast): void {
  try {
    channel?.postMessage(message);
  } catch {
    /* channel closed: other tabs fall back to their own focus/refresh */
  }
}

/**
 * One outbox cycle, cross-tab safe: only the tab holding the per-business
 * lock replays (FIFO, idempotent as before). It then refreshes its screens
 * and tells the other tabs. A tab that isn't the leader does nothing now;
 * it refreshes on the leader's "complete" broadcast.
 */
export async function syncAllPendingAsLeader(businessId: string): Promise<SyncAllResult | null> {
  const run = await runAsLeader(businessId, async () => {
    leading += 1;
    try {
      return await syncAllPending(businessId).catch(() => null);
    } finally {
      leading -= 1;
    }
  });
  if (!run.leader) {
    navDebug("outbox-sync-follower", {});
    return null;
  }
  emitSyncComplete(businessId);
  post({ type: "complete", businessId });
  return run.value;
}

async function hasLocalPending(businessId: string): Promise<boolean> {
  try {
    return (await getOutboxStore().listByStatus(businessId, "pending")).length > 0;
  } catch {
    return false;
  }
}

async function releaseRetryBackoffOnReconnect(businessId: string): Promise<void> {
  try {
    const db = getLocalDb();
    const failed = await getOutboxStore().listByStatus(businessId, "failed");
    for (const row of failed) {
      if (row.nextAttemptAt != null && row.nextAttemptAt > 0) {
        await db.outbox.put({ ...row, nextAttemptAt: 0 });
      }
    }
  } catch {
    /* ignore */
  }
}

async function nextRetryDelayMs(businessId: string): Promise<number | null> {
  try {
    const failed = await getOutboxStore().listByStatus(businessId, "failed");
    const due = failed.map((r) => r.nextAttemptAt).filter((t): t is number => t != null);
    if (due.length === 0) return null;
    return Math.max(50, Math.min(...due) - Date.now());
  } catch {
    return null;
  }
}

let stopOutboxSync: (() => void) | null = null;

/**
 * Single connectivity bridge for the whole outbox. Replaces the previous
 * four independent monitors (one per operation type) that raced each other
 * and starved all but the first flushed type.
 */
export function startOutboxSync(): () => void {
  if (stopOutboxSync) return stopOutboxSync;
  const monitor = new ConnectivityMonitor();
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const clearRetryTimer = () => {
    if (retryTimer != null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };
  const run = (reconnect = false) => {
    clearRetryTimer();
    const businessId = getPwaAuthSession().businessId;
    navDebug("outbox-sync-run", { online: monitor.online, hasBusiness: !!businessId });
    if (businessId && monitor.online) {
      // Reconnect data refresh (reloadOnOnline is off): open screens re-run their
      // store load once the LEADER's outbox flush is done, so they show server
      // data including what was just sent. Data only; never a page reload.
      const prep = reconnect ? releaseRetryBackoffOnReconnect(businessId) : Promise.resolve();
      void prep.then(() => syncAllPendingAsLeader(businessId)).then(async () => {
        if (!monitor.online) return;
        const delay = await nextRetryDelayMs(businessId);
        if (delay != null && monitor.online) {
          clearRetryTimer();
          retryTimer = setTimeout(() => run(false), delay);
        }
      });
    }
  };
  channel = openSyncChannel();
  // Leader → followers: mirror progress so «Enviando X de Y» moves and ends
  // in every tab. Events received from another tab are tagged `remote`.
  const forward = (event: Event) => {
    const detail = (event as CustomEvent<Record<string, unknown>>).detail;
    if (!leading || !detail || detail.remote) return;
    const businessId = (detail.businessId as string | undefined) ?? getPwaAuthSession().businessId;
    if (businessId) post({ type: "progress", businessId, detail });
  };
  window.addEventListener("dulcecalle:sync", forward);
  if (channel) {
    channel.onmessage = (e) => {
      const msg = e.data as SyncBroadcast | undefined;
      const mine = getPwaAuthSession().businessId;
      if (!msg || !mine || msg.businessId !== mine) return;
      if (msg.type === "progress") {
        window.dispatchEvent(new CustomEvent("dulcecalle:sync", { detail: { ...msg.detail, remote: true } }));
        return;
      }
      emitSyncComplete(mine);
      // Something queued after the leader's snapshot? Take a turn.
      if (monitor.online) {
        void hasLocalPending(mine).then((left) => {
          if (left) void syncAllPendingAsLeader(mine);
        });
      }
    };
  }
  monitor.start();
  monitor.refresh();
  run();
  const unsubscribe = monitor.subscribe((online) => {
    navDebug("connectivity", { online });
    if (online) run(true);
    else clearRetryTimer();
  });
  stopOutboxSync = () => {
    clearRetryTimer();
    unsubscribe();
    monitor.stop();
    window.removeEventListener("dulcecalle:sync", forward);
    channel?.close?.();
    channel = null;
    stopOutboxSync = null;
  };
  return stopOutboxSync;
}
