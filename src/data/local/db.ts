import Dexie, { type EntityTable } from "dexie";
import type {
  CustomerLedgerSnapshot,
  LocalCacheMeta,
  LocalSnapshot,
  PortalCatalogSnapshot,
  PrepReadiness,
  LocalCashMove,
  LocalCashSession,
  LocalCustomer,
  LocalCustomerPayment,
  LocalExpense,
  LocalInitialDebt,
  LocalPendingMedia,
  LocalProduct,
  LocalSale,
  LocalSaleLine,
  LocalSaleReturn,
  LocalSaleReturnLine,
  LocalStockMove,
  LocalSupplier,
  OutboxItem,
} from "./types";

/**
 * M6 local store. Separate database from legacy Dexie `"dulcecalle"` (++id).
 * Never migrate number → UUID in place. Palette/theme still uses `"dulcecalle"`.
 */
export const LOCAL_DB_NAME = "dulcecalle-local";

export class DulceCalleLocalDB extends Dexie {
  products!: EntityTable<LocalProduct, "id">;
  customers!: EntityTable<LocalCustomer, "id">;
  suppliers!: EntityTable<LocalSupplier, "id">;
  sales!: EntityTable<LocalSale, "id">;
  saleLines!: EntityTable<LocalSaleLine, "id">;
  saleReturns!: EntityTable<LocalSaleReturn, "id">;
  saleReturnLines!: EntityTable<LocalSaleReturnLine, "id">;
  stockMoves!: EntityTable<LocalStockMove, "id">;
  cashSessions!: EntityTable<LocalCashSession, "id">;
  cashMoves!: EntityTable<LocalCashMove, "id">;
  expenses!: EntityTable<LocalExpense, "id">;
  customerPayments!: EntityTable<LocalCustomerPayment, "id">;
  initialDebts!: EntityTable<LocalInitialDebt, "id">;
  cacheMeta!: EntityTable<LocalCacheMeta, "id">;
  customerLedgers!: EntityTable<CustomerLedgerSnapshot, "customerId">;
  prepState!: EntityTable<PrepReadiness, "id">;
  snapshots!: EntityTable<LocalSnapshot, "id">;
  portalCatalogs!: EntityTable<PortalCatalogSnapshot, "customerId">;
  pendingMedia!: EntityTable<LocalPendingMedia, "id">;
  outbox!: EntityTable<OutboxItem, "operationId">;

  constructor() {
    super(LOCAL_DB_NAME);
    this.version(1).stores({
      products: "id, businessId, [businessId+id], [businessId+updatedAt]",
      customers: "id, businessId, [businessId+id], [businessId+updatedAt]",
      suppliers: "id, businessId, [businessId+id], [businessId+updatedAt]",
      sales: "id, businessId, [businessId+id], [businessId+updatedAt], requestId",
      saleLines: "id, businessId, saleId, [businessId+saleId]",
      saleReturns: "id, businessId, saleId, requestId, [businessId+saleId]",
      saleReturnLines: "id, businessId, returnId, [businessId+returnId]",
      stockMoves: "id, businessId, productId, [businessId+productId]",
      cashSessions: "id, businessId, localDate, [businessId+localDate]",
      cashMoves: "id, businessId, sessionId, [businessId+id]",
      expenses: "id, businessId, [businessId+id]",
      customerPayments: "id, businessId, customerId, requestId, [businessId+customerId]",
      initialDebts: "id, businessId, customerId, requestId, [businessId+customerId]",
      outbox:
        "operationId, businessId, status, requestId, localCreatedAt, [businessId+status], &[businessId+requestId], [businessId+localCreatedAt]",
    });
    // v2: snapshot presence so an empty GET is distinct from "never cached".
    this.version(2).stores({
      cacheMeta: "id, businessId, resource, [businessId+resource]",
    });
    this.version(3).stores({
      cashSessions: "id, businessId, localDate, requestId, [businessId+localDate], [businessId+requestId]",
    });
    // v4 (M6.10): customer portal ledger snapshot, keyed by customerId.
    // The portal never uses businessId, so it stays out of cacheMeta.
    this.version(4).stores({
      customerLedgers: "customerId, capturedAt",
    });
    // v5: offline preparation readiness (per business, metadata only).
    this.version(5).stores({
      prepState: "id, businessId",
    });
    // v6 (M6.13): generic server snapshots for offline display
    // (dashboard, stats). Tenant-keyed; presence means "cached".
    this.version(6).stores({
      snapshots: "id, businessId, kind, [businessId+kind]",
    });
    // v7: pending product media. Blobs live here (never in the outbox
    // payload) until each upload registers server-side, then are deleted.
    this.version(7).stores({
      pendingMedia:
        "id, businessId, productId, requestId, status, [businessId+productId], [businessId+status]",
    });
    // v8: portal product catalog snapshot, keyed by customerId like the
    // M6.10 ledger cache. No businessId on the portal by design.
    this.version(8).stores({
      portalCatalogs: "customerId, capturedAt",
    });
  }
}

let singleton: DulceCalleLocalDB | null = null;

export function getLocalDb(): DulceCalleLocalDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available");
  }
  if (!singleton) singleton = new DulceCalleLocalDB();
  return singleton;
}

/** Test-only: drop M6 local DB. Does not touch legacy `"dulcecalle"`. */
export async function __resetLocalDbForTests(): Promise<void> {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
  await Dexie.delete(LOCAL_DB_NAME);
  singleton = null;
}

/** Test-only: close without deleting (simulate reload). */
export function __reopenLocalDbForTests(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
