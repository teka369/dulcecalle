import type { EntityTable } from "dexie";
import { getLocalDb, type DulceCalleLocalDB } from "./db";
import { assertUuid } from "./ids";
import type { LocalSaleLine } from "./types";

type TenantRow = { id: string; businessId: string };

function scoped<T extends TenantRow>(
  db: DulceCalleLocalDB,
  table: EntityTable<T, "id">,
) {
  return {
    async put(row: T): Promise<void> {
      assertUuid(row.id, "id");
      assertUuid(row.businessId, "businessId");
      const existing = await table.where("id").equals(row.id).first();
      if (existing && existing.businessId !== row.businessId) {
        throw new Error("id belongs to another business");
      }
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
    async replaceAll(businessId: string, rows: T[]): Promise<void> {
      assertUuid(businessId, "businessId");
      for (const row of rows) {
        assertUuid(row.id, "id");
        assertUuid(row.businessId, "businessId");
        if (row.businessId !== businessId) {
          throw new Error("row businessId mismatch");
        }
      }
      await db.transaction("rw", table, async () => {
        for (const row of rows) {
          const existing = await table.where("id").equals(row.id).first();
          if (existing && existing.businessId !== businessId) {
            throw new Error("id belongs to another business");
          }
        }
        await table.where("businessId").equals(businessId).delete();
        if (rows.length > 0) await table.bulkPut(rows);
      });
    },
  };
}

/**
 * M6 local cache. Always scoped by businessId.
 * M6.3 catalog reads may use this as a copy. PostgreSQL remains the authority.
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
    this.products = scoped(this.db, this.db.products);
    this.customers = scoped(this.db, this.db.customers);
    this.suppliers = scoped(this.db, this.db.suppliers);
    this.sales = scoped(this.db, this.db.sales);
    this.saleLines = scoped(this.db, this.db.saleLines);
    this.saleReturns = scoped(this.db, this.db.saleReturns);
    this.saleReturnLines = scoped(this.db, this.db.saleReturnLines);
    this.stockMoves = scoped(this.db, this.db.stockMoves);
    this.cashSessions = scoped(this.db, this.db.cashSessions);
    this.cashMoves = scoped(this.db, this.db.cashMoves);
    this.expenses = scoped(this.db, this.db.expenses);
    this.customerPayments = scoped(this.db, this.db.customerPayments);
    this.initialDebts = scoped(this.db, this.db.initialDebts);
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
