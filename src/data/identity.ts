/**
 * Identity bridge (Fase 6.7). Design only — does not import Dexie or POST rows.
 *
 * Dexie: autoincrement number (`++id`).
 * Backend: UUID PK + nullable `legacy_dexie_id` + `import_id_map`.
 */

export type DexieId = number;
export type RemoteId = string;

/** Prisma / DATABASE.md `import_id_map.table_name` values, FK-safe order. */
export const IMPORT_TABLE_ORDER = [
  "products",
  "customers",
  "suppliers",
  "cash_sessions",
  "sales",
  "sale_lines",
  "sale_returns",
  "sale_return_lines",
  "stock_moves",
  "customer_payments",
  "initial_debts",
  "expenses",
  "cash_moves",
] as const;

export type ImportTableName = (typeof IMPORT_TABLE_ORDER)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRemoteUuid(value: unknown): value is RemoteId {
  return typeof value === "string" && UUID_RE.test(value);
}

export function isDexieNumericId(value: unknown): value is DexieId {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Dexie-era helper. PWA routes now use `routeId()` (UUID). */
export function dexieRouteIdFromParam(raw: string): DexieId {
  const n = Number(raw);
  if (!isDexieNumericId(n) || String(n) !== raw.trim()) {
    throw new Error("Dexie route id must be a positive integer");
  }
  return n;
}

export function uuidWouldBreakDexieRoute(raw: string): boolean {
  try {
    dexieRouteIdFromParam(raw);
    return false;
  } catch {
    return true;
  }
}

export function importMapKey(table: ImportTableName, dexieId: DexieId): string {
  return `${table}:${dexieId}`;
}

export type ImportIdMap = Record<string, RemoteId>;

export function resolveImportId(
  map: ImportIdMap,
  table: ImportTableName,
  dexieId: DexieId,
): RemoteId {
  const pgId = map[importMapKey(table, dexieId)];
  if (!pgId || !isRemoteUuid(pgId)) {
    throw new Error(`no import mapping for ${table}#${dexieId}`);
  }
  return pgId;
}

/**
 * InitialDebt import: copy the row. Never a Sale / CashMove / StockMove.
 * Customer.debt cache is reconciled after, not recomputed by the adapter.
 */
export const INITIAL_DEBT_IMPORT = {
  table: "initial_debts" as const,
  createsSale: false,
  createsCashMove: false,
  createsStockMove: false,
  touchesVentas: false,
  touchesRecibido: false,
} as const;
