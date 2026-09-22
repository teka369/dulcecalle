import { getPwaAuthSession } from "../http/session";
import { ConnectivityMonitor, type SyncFlushResult } from "../local/outbox";
import { syncPendingCustomers, syncPendingProducts, syncPendingSuppliers } from "./offline-catalog";
import { syncPendingOperations } from "./offline-operations";
import { syncPendingPayments } from "./offline-payments";
import { syncPendingSales } from "./offline-sales";

export type SyncAllResult = {
  sales: SyncFlushResult;
  payments: SyncFlushResult;
  customers: SyncFlushResult;
  suppliers: SyncFlushResult;
  products: SyncFlushResult;
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
export async function syncAllPending(businessId: string): Promise<SyncAllResult> {
  const sales = await syncPendingSales(businessId);
  const payments = await syncPendingPayments(businessId);
  const customers = await syncPendingCustomers(businessId);
  const suppliers = await syncPendingSuppliers(businessId);
  const products = await syncPendingProducts(businessId);
  const operations = await syncPendingOperations(businessId);
  return { sales, payments, customers, suppliers, products, operations };
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
