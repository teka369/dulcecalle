/** Pure view helpers for Inventario pages. Same rules the pages used inline; no domain changes. */

export type StockLike = { id: string; name: string; stock: number; lowStockAt: number; archivedAt?: string | null };
export type ValueLike = { stock: number; avgCost: number; sellable: boolean };

/** Existing list rule: stock ≤ lowStockAt. */
export function isLowStock(p: Pick<StockLike, "stock" | "lowStockAt">): boolean {
  return p.stock <= p.lowStockAt;
}

export function isOutOfStock(p: Pick<StockLike, "stock">): boolean {
  return p.stock <= 0;
}

/** Hero counts: products in list and how many are low (includes agotados). */
export function inventoryCounts(list: ReadonlyArray<Pick<StockLike, "stock" | "lowStockAt">>) {
  return { products: list.length, low: list.filter(isLowStock).length };
}

/** STOCK BAJO first, then TODOS (rest); name search keeps the original order. */
export function splitByStock<T extends StockLike>(list: ReadonlyArray<T>, query: string): { low: T[]; rest: T[] } {
  const q = query.trim().toLowerCase();
  const hits = q ? list.filter((p) => p.name.toLowerCase().includes(q)) : [...list];
  return { low: hits.filter(isLowStock), rest: hits.filter((p) => !isLowStock(p)) };
}

/**
 * Money tied up in stock (≠ units). Sellable: stock × avgCost.
 * Insumo/combo: avgCost already is the remaining lot value (domain rule used by Preparar).
 */
export function inventoryValue(p: ValueLike): number {
  return p.sellable ? p.stock * p.avgCost : p.avgCost;
}

/** «Quedará X u.»: stock after adding (+1) or removing (−1) qtyRaw; null when qty is not a positive integer. */
export function stockAfter(stock: number, qtyRaw: string, sign: 1 | -1): number | null {
  const digits = qtyRaw.replace(/\D/g, "");
  if (!digits) return null;
  const qty = Number.parseInt(digits, 10);
  if (!Number.isInteger(qty) || qty <= 0) return null;
  return stock + sign * qty;
}

/** Stepper: next qty string, floored at 0 and capped at max when given. */
export function stepQty(raw: string, d: number, max?: number): string {
  const cur = Number.parseInt(raw.replace(/\D/g, "") || "0", 10);
  let n = Math.max(0, cur + d);
  if (max != null) n = Math.min(n, Math.max(0, max));
  return n === 0 ? "" : String(n);
}

/** Unit cost hint for the total entered (client calc, rounded like Surtir does). */
export function unitCostHint(totalRaw: string, qtyRaw: string): number | null {
  const total = Number.parseInt(totalRaw || "", 10);
  const qty = Number.parseInt(qtyRaw || "", 10);
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(qty) || qty <= 0) return null;
  return Math.round(total / qty);
}

/** Move delta with sign and a word (not colour only). */
export function moveDelta(delta: number): { sign: "+" | "−"; qty: number; word: "Entra" | "Sale"; tone: "ok" | "danger" } {
  return delta >= 0
    ? { sign: "+", qty: delta, word: "Entra", tone: "ok" }
    : { sign: "−", qty: -delta, word: "Sale", tone: "danger" };
}

export function units(n: number): string {
  return `${n} u.`;
}

/** Typed qty: digits only, capped at max (stock) so «Quedará» never goes negative. */
export function clampQty(raw: string, max?: number): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits || max == null) return digits;
  const n = Number.parseInt(digits, 10);
  return n > max ? String(Math.max(0, max)) : digits;
}

/** «2026-10-13» → «13/10/2026». Anything else is returned unchanged. */
export function dmy(dateKey: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateKey ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (dateKey ?? "");
}
