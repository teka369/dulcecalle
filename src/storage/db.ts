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
  Supplier,
} from "@/domain/types";

/**
 * DulceCalle IndexedDB schema.
 * v1: foundation tables
 * v2: suppliers (light — NO CxP). StockMove.supplierId is optional payload (no new index).
 * v3: cashSessions.localDate (1 session / calendar day).
 * v4: customerPayments.requestId (abono idempotency).
 * Data lives in Dexie — NOT in the Cache API.
 */
export class DulceCalleDB extends Dexie {
  products!: EntityTable<Product, "id">;
  customers!: EntityTable<Customer, "id">;
  suppliers!: EntityTable<Supplier, "id">;
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
    // S3: light suppliers (name/phone/notes + surtir history). NO CxP tables.
    this.version(2).stores({
      suppliers: "++id, name",
    });
    // S4: 1 cash session per localDate; closingCount = Efectivo físico.
    this.version(3).stores({
      cashSessions: "++id, openedAt, closedAt, localDate",
    });
    // P0: idempotent abonos (same requestId → no second debt decrement).
    this.version(4).stores({
      customerPayments: "++id, customerId, createdAt, saleId, requestId",
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

/** Test-only: close singleton without deleting IndexedDB (simulate reload). */
export function __reopenDbForTests(): void {
  if (dbSingleton) {
    dbSingleton.close();
    dbSingleton = null;
  }
}

export type { DulceCalleDB as DulceCalleDatabase };
