import { parseAmountInput } from "@/domain/money/limits";

export const SALE_ERRORS = {
  empty: "Agrega al menos un producto.",
  badPrice: "El precio tiene que ser 0 o más.",
  badQty: "La cantidad tiene que ser mayor a 0.",
} as const;

export type TilePriceDraftUpdate = {
  draft: string;
  priceError: string | null;
  invalid: boolean;
  /**
   * Digits string to pass to onPriceChange: either parsed digits when valid,
   * or String(basePrice) when rejected so partial prefixes (e.g. "12" before
   * "a" or "20000000" before the 9th "0") never stick in the cart.
   */
  effectiveDigits: string;
};

export function evaluateTilePriceDraft(
  raw: string,
  basePrice: number,
): TilePriceDraftUpdate {
  const parsed = parseAmountInput(raw);
  if ("error" in parsed) {
    return {
      draft: raw,
      priceError: parsed.error,
      invalid: true,
      effectiveDigits: String(basePrice),
    };
  }
  return {
    draft: raw,
    priceError: null,
    invalid: false,
    effectiveDigits: parsed.digits,
  };
}

/**
 * Parse an optional per-sale unit price override.
 * Empty → fallback (catalog price). Must be integer ≥ 0 and ≤ MAX_COP_AMOUNT.
 */
export function parseSaleUnitPrice(
  raw: string,
  fallback: number,
): { unitPrice: number } | { error: string } {
  const t = raw.trim();
  if (t === "") return { unitPrice: fallback };
  const amount = parseAmountInput(t);
  if ("error" in amount) return amount;
  if (amount.digits === "") return { unitPrice: fallback };
  const n = Number.parseInt(amount.digits, 10);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { error: SALE_ERRORS.badPrice };
  }
  return { unitPrice: n };
}
