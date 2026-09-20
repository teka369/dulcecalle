import Dexie, { type EntityTable } from "dexie";
import type {
  LocalCashMove,
  LocalCashSession,
  LocalCustomer,
  LocalCustomerPayment,
  LocalExpense,
  LocalInitialDebt,
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
