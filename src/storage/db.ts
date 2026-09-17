import Dexie, { type EntityTable } from "dexie";
import type {
  CashMove,
  CashSession,
  Customer,
  CustomerPayment,
  Expense,
  Product,
  Sale,
  SaleLine,
  Setting,
  StockMove,
} from "@/domain/types";

/**
 * DulceCalle IndexedDB schema v1 (Investigador names).
 * Data lives in Dexie — NOT in the Cache API.
 */
export class DulceCalleDB extends Dexie {
  products!: EntityTable<Product, "id">;
  customers!: EntityTable<Customer, "id">;
  sales!: EntityTable<Sale, "id">;
  saleLines!: EntityTable<SaleLine, "id">;
  stockMoves!: EntityTable<StockMove, "id">;
  customerPayments!: EntityTable<CustomerPayment, "id">;
  expenses!: EntityTable<Expense, "id">;
  cashMoves!: EntityTable<CashMove, "id">;
  cashSessions!: EntityTable<CashSession, "id">;
  settings!: EntityTable<Setting, "key">;

  constructor() {
    super("dulcecalle");
    this.version(1).stores({
      products: "++id, name, category, stock",
      customers: "++id, name, debt",
      sales: "++id, createdAt, customerId, paymentKind",
      saleLines: "++id, saleId, productId",
      stockMoves: "++id, productId, createdAt, reason",
      customerPayments: "++id, customerId, createdAt, saleId",
      expenses: "++id, createdAt",
      cashMoves: "++id, createdAt, method, kind, sessionId",
      cashSessions: "++id, openedAt, closedAt",
      settings: "key",
    });
  }
}

let dbSingleton: DulceCalleDB | null = null;

export function getDb(): DulceCalleDB {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB is not available");
  }
  if (!dbSingleton) {
    dbSingleton = new DulceCalleDB();
  }
  return dbSingleton;
}

/** Test-only: close and drop singleton so the next getDb() is fresh. */
export async function __resetDbForTests(): Promise<void> {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
  await Dexie.delete("dulcecalle");
  dbSingleton = null;
}

export type { DulceCalleDB as DulceCalleDatabase };
