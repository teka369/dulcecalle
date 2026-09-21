import { getLocalDb } from "../local/db";
import { assertUuid } from "../local/ids";

/**
 * Local counterpart of the server business-data reset. Removes every
 * business-scoped row of the given business: catalog, operations, outbox
 * (pending/in_flight/failed/synced — nothing may resurrect the wiped
 * server data), read-cache meta and preparation readiness.
 *
 * customerLedgers is intentionally kept: it belongs to portal sessions
 * (M6.10, keyed by customerId) and heals itself on the next online fetch.
 */
export async function clearLocalBusinessData(businessId: string): Promise<void> {
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
    },
  );
}
