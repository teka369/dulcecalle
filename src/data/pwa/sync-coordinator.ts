import { getPwaAuthSession } from "../http/session";
import { ConnectivityMonitor, type SyncFlushResult } from "../local/outbox";
import { syncPendingCustomers, syncPendingProducts, syncPendingSuppliers } from "./offline-catalog";
import { syncPendingProductImages } from "./product-images";
import { syncPendingPreparations } from "./offline-production";
import { syncPendingOperations } from "./offline-operations";
import { syncPendingPayments } from "./offline-payments";
import { syncPendingSales } from "./offline-sales";

export type SyncAllResult = {
  sales: SyncFlushResult;
  payments: SyncFlushResult;
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

export async function syncAllPending(businessId: string): Promise<SyncAllResult> {
  const result: SyncAllResult = {
    sales: AUTH_IDLE,
    payments: AUTH_IDLE,
    customers: AUTH_IDLE,
    suppliers: AUTH_IDLE,
    products: AUTH_IDLE,
    images: AUTH_IDLE,
    preparations: AUTH_IDLE,
    operations: AUTH_IDLE,
  };
  const steps: Array<[keyof SyncAllResult, () => Promise<SyncFlushResult>]> = [
    ["sales", () => syncPendingSales(businessId)],
    ["payments", () => syncPendingPayments(businessId)],
    ["customers", () => syncPendingCustomers(businessId)],
    ["suppliers", () => syncPendingSuppliers(businessId)],
    ["products", () => syncPendingProducts(businessId)],
    ["images", () => syncPendingProductImages(businessId)],
    ["preparations", () => syncPendingPreparations(businessId)],
    ["operations", () => syncPendingOperations(businessId)],
  ];
  for (const [key, run] of steps) {
    const flush = await run();
    result[key] = flush;
    if (flush.authRequired) break;
  }
  return result;
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
  const run = () => {
    const businessId = getPwaAuthSession().businessId;
    if (businessId && monitor.online) void syncAllPending(businessId);
  };
  monitor.start();
  monitor.refresh();
  run();
  const unsubscribe = monitor.subscribe((online) => {
    if (online) run();
  });
  stopOutboxSync = () => {
    unsubscribe();
    monitor.stop();
    stopOutboxSync = null;
  };
  return stopOutboxSync;
}
