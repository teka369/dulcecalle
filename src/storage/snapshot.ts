/**
 * Read-only Dexie snapshot (Fase 6.9).
 * Never writes, deletes, or replays operations.
 */
import { getDb } from "./db";

export const DEXIE_SCHEMA_VERSION = 8 as const;
export const SNAPSHOT_TABLES = [
  "settings",
  "products",
  "customers",
  "suppliers",
  "sales",
  "saleLines",
  "saleReturns",
  "saleReturnLines",
  "stockMoves",
  "cashSessions",
  "cashMoves",
  "customerPayments",
  "initialDebts",
  "expenses",
] as const;

export type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

export type DexieSnapshot = {
  snapshotId: string;
  createdAt: string;
  source: "DEXIE";
  claim: "DEVICE_COPY";
  schemaVersion: typeof DEXIE_SCHEMA_VERSION;
  dbName: "dulcecalle";
  recordCounts: Record<SnapshotTable, number>;
  checksum: string;
  tables: Record<SnapshotTable, unknown[]>;
};

function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `snap-${Date.now()}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export async function hashUtf8(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SHA-256 is not available in this environment");
  }
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function checksumTables(
  tables: Record<SnapshotTable, unknown[]>,
): Promise<string> {
  return hashUtf8(stableStringify(tables));
}

/** Read-only copy of every Dexie table. Does not mutate IndexedDB. */
export async function exportDexieSnapshot(): Promise<DexieSnapshot> {
  const db = getDb();
  const tables = {
    settings: await db.settings.toArray(),
    products: await db.products.toArray(),
    customers: await db.customers.toArray(),
    suppliers: await db.suppliers.toArray(),
    sales: await db.sales.toArray(),
    saleLines: await db.saleLines.toArray(),
    saleReturns: await db.saleReturns.toArray(),
    saleReturnLines: await db.saleReturnLines.toArray(),
    stockMoves: await db.stockMoves.toArray(),
    cashSessions: await db.cashSessions.toArray(),
    cashMoves: await db.cashMoves.toArray(),
    customerPayments: await db.customerPayments.toArray(),
    initialDebts: await db.initialDebts.toArray(),
    expenses: await db.expenses.toArray(),
  };
  const recordCounts = Object.fromEntries(
    SNAPSHOT_TABLES.map((t) => [t, tables[t].length]),
  ) as Record<SnapshotTable, number>;
  const checksum = await checksumTables(tables);
  return {
    snapshotId: newId(),
    createdAt: new Date().toISOString(),
    source: "DEXIE",
    claim: "DEVICE_COPY",
    schemaVersion: DEXIE_SCHEMA_VERSION,
    dbName: "dulcecalle",
    recordCounts,
    checksum,
    tables,
  };
}

export async function verifySnapshotUnchanged(
  first: DexieSnapshot,
  second: DexieSnapshot,
): Promise<{ ok: boolean; reason?: string }> {
  if (first.checksum !== second.checksum) {
    return { ok: false, reason: "SNAPSHOT_CHANGED checksum" };
  }
  for (const t of SNAPSHOT_TABLES) {
    if (first.recordCounts[t] !== second.recordCounts[t]) {
      return { ok: false, reason: `SNAPSHOT_CHANGED count ${t}` };
    }
  }
  return { ok: true };
}
