export const SALE_ERRORS = {
  empty: "Agrega al menos un producto.",
  badPrice: "El precio tiene que ser 0 o más.",
  badQty: "La cantidad tiene que ser mayor a 0.",
} as const;

/**
 * Parse an optional per-sale unit price override.
 * Empty → fallback (catalog price). Must be integer ≥ 0.
 */
export function parseSaleUnitPrice(
  raw: string,
  fallback: number,
): { unitPrice: number } | { error: string } {
  const t = raw.trim();
  if (t === "") return { unitPrice: fallback };
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { error: SALE_ERRORS.badPrice };
  }
  return { unitPrice: n };
}
