/** Copy for «Agregar deuda anterior» — not a sale, not an abono. */
export const INITIAL_DEBT_ERRORS = {
  empty: "Escribe cuánto debía.",
  notPositive: "La deuda tiene que ser mayor a 0.",
} as const;

export const INITIAL_DEBT_TOAST = "Deuda anterior registrada";

/**
 * Validate the amount field. Empty / NaN → empty; ≤ 0 → notPositive.
 */
export function validateInitialDebtAmount(amountRaw: string): string | null {
  const raw = amountRaw.trim();
  if (raw === "") return INITIAL_DEBT_ERRORS.empty;
  const amount = Number.parseInt(raw, 10);
  if (!Number.isFinite(amount) || Number.isNaN(amount) || !Number.isInteger(amount)) {
    return INITIAL_DEBT_ERRORS.empty;
  }
  if (amount <= 0) return INITIAL_DEBT_ERRORS.notPositive;
  return null;
}

export function parseInitialDebtAmount(amountRaw: string): number {
  return Number.parseInt(amountRaw.trim(), 10);
}
