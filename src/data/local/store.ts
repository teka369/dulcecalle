import type { EntityTable } from "dexie";
import { getLocalDb, type DulceCalleLocalDB } from "./db";
import { assertUuid } from "./ids";
import type { LocalSaleLine } from "./types";

type TenantRow = { id: string; businessId: string };

function scoped<T extends TenantRow>(table: EntityTable<T, "id">) {
  return {
    async put(row: T): Promise<void> {
      assertUuid(row.id, "id");
      assertUuid(row.businessId, "businessId");
      await table.put(row);
    },
    async get(businessId: string, id: string): Promise<T | undefined> {
      assertUuid(businessId, "businessId");
      assertUuid(id, "id");
      const row = await table.where("id").equals(id).first();
      if (!row || row.businessId !== businessId) return undefined;
      return row;
    },
    async list(businessId: string): Promise<T[]> {
      assertUuid(businessId, "businessId");
      return table.where("businessId").equals(businessId).toArray();
    },
  };
}

/**
 * M6 local cache. Always scoped by businessId.
 * Not wired to pages. PostgreSQL remains the authority.
 */
export class LocalStore {
  readonly products;
  readonly customers;
  readonly suppliers;
  readonly sales;
  readonly saleLines;
  readonly saleReturns;
  readonly saleReturnLines;
  readonly stockMoves;
  readonly cashSessions;
  readonly cashMoves;
  readonly expenses;
  readonly customerPayments;
  readonly initialDebts;

  constructor(private readonly db: DulceCalleLocalDB = getLocalDb()) {
    this.products = scoped(this.db.products);
    this.customers = scoped(this.db.customers);
    this.suppliers = scoped(this.db.suppliers);
    this.sales = scoped(this.db.sales);
    this.saleLines = scoped(this.db.saleLines);
    this.saleReturns = scoped(this.db.saleReturns);
    this.saleReturnLines = scoped(this.db.saleReturnLines);
    this.stockMoves = scoped(this.db.stockMoves);
    this.cashSessions = scoped(this.db.cashSessions);
    this.cashMoves = scoped(this.db.cashMoves);
    this.expenses = scoped(this.db.expenses);
    this.customerPayments = scoped(this.db.customerPayments);
    this.initialDebts = scoped(this.db.initialDebts);
  }

  async listSaleLines(businessId: string, saleId: string): Promise<LocalSaleLine[]> {
    assertUuid(businessId, "businessId");
    assertUuid(saleId, "saleId");
    const rows = await this.db.saleLines.where("saleId").equals(saleId).toArray();
    return rows.filter((row) => row.businessId === businessId);
  }
}

let storeSingleton: LocalStore | null = null;

export function getLocalStore(): LocalStore {
  if (!storeSingleton) storeSingleton = new LocalStore();
  return storeSingleton;
}

export function resetLocalStoreSingleton(): void {
  storeSingleton = null;
}
