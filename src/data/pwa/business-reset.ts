import { getLocalDb } from "../local/db";
import { assertUuid } from "../local/ids";

export type ClearLocalBusinessDataOptions = {
  /**
   * Portal customer ids wiped on the server with this business. Their
   * ledger snapshots (keyed by customerId, carrying no businessId) are
   * removed so a stale ledger can never render offline again. Snapshots
   * of any other customer stay untouched.
   */
  customerIds?: string[];
};

/**
 * Local counterpart of the server business-data reset. Removes every
 * business-scoped row of the given business: catalog, operations, outbox
 * (pending/in_flight/failed/synced — nothing may resurrect the wiped
 * server data), read-cache meta and preparation readiness.
 *
 * customerLedgers rows NOT listed in `customerIds` are intentionally kept:
 * they belong to portal sessions (M6.10) and heal on the next online fetch.
 * Pending media blobs are business-scoped and always wiped: they reference
 * products that no longer exist after the reset.
 */
export async function clearLocalBusinessData(
  businessId: string,
  opts: ClearLocalBusinessDataOptions = {},
): Promise<void> {
  assertUuid(businessId, "businessId");
  const db = getLocalDb();
  await db.transaction(
    "rw",
    [
      db.products,
      db.customers,
      db.suppliers,
      db.sales,
      db.saleLines,
      db.saleReturns,
      db.saleReturnLines,
      db.stockMoves,
      db.cashSessions,
      db.cashMoves,
      db.expenses,
      db.customerPayments,
      db.initialDebts,
      db.outbox,
      db.cacheMeta,
      db.prepState,
      db.snapshots,
      db.customerLedgers,
      db.portalCatalogs,
      db.pendingMedia,
    ],
    async () => {
      await db.products.where("businessId").equals(businessId).delete();
      await db.customers.where("businessId").equals(businessId).delete();
      await db.suppliers.where("businessId").equals(businessId).delete();
      await db.sales.where("businessId").equals(businessId).delete();
      await db.saleLines.where("businessId").equals(businessId).delete();
      await db.saleReturns.where("businessId").equals(businessId).delete();
      await db.saleReturnLines.where("businessId").equals(businessId).delete();
      await db.stockMoves.where("businessId").equals(businessId).delete();
      await db.cashSessions.where("businessId").equals(businessId).delete();
      await db.cashMoves.where("businessId").equals(businessId).delete();
      await db.expenses.where("businessId").equals(businessId).delete();
      await db.customerPayments.where("businessId").equals(businessId).delete();
      await db.initialDebts.where("businessId").equals(businessId).delete();
      await db.outbox.where("businessId").equals(businessId).delete();
      await db.cacheMeta.where("businessId").equals(businessId).delete();
      await db.prepState.where("businessId").equals(businessId).delete();
      await db.snapshots.where("businessId").equals(businessId).delete();
      await db.pendingMedia.where("businessId").equals(businessId).delete();
      for (const customerId of opts.customerIds ?? []) {
        await db.customerLedgers.delete(customerId);
        await db.portalCatalogs.delete(customerId);
      }
    },
  );
}
