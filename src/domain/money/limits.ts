/**
 * Ceiling for a single COP amount typed by the user (aporte, retiro, gasto,
 * abono, deuda anterior, conteo de caja, precio, costo…).
 *
 * 100.000.000 COP (cien millones) is far above any single operation of a
 * street candy business and keeps every derived sum (caja del día, deuda,
 * inventario) well inside Number.MAX_SAFE_INTEGER. The backend DTOs enforce
 * the same value (backend/src/shared/money.ts MAX_COP_AMOUNT).
 */
export const MAX_COP_AMOUNT = 100_000_000;

export const AMOUNT_TOO_LARGE_MESSAGE = "El monto es demasiado grande. El máximo es $ 100.000.000.";
export const AMOUNT_DECIMAL_MESSAGE = "Escribe el monto en pesos, sin centavos (sin coma ni decimales).";

export const AMOUNT_NOT_A_NUMBER_MESSAGE = "Escribe solo números (sin letras ni símbolos). Puedes usar puntos de miles: 1.500.";

export type AmountInputResult = { digits: string } | { error: string };

/** True when a raw amount (digits) is above MAX_COP_AMOUNT. */
export function exceedsMaxCop(raw: string): boolean {
  const digits = raw.trim();
  if (!/^\d+$/.test(digits)) return false;
  // Compare by length first so 20+ digit strings never go through Number.
  const clean = digits.replace(/^0+(?=\d)/, "");
  return clean.length > String(MAX_COP_AMOUNT).length || Number(clean) > MAX_COP_AMOUNT;
}

/**
 * Parse what the user typed/pasted into an amount field. COP is integer:
 * - «1.500» / «1.250.000» are es-CO thousands separators → 1500 / 1250000.
 * - Any comma, or a dot that is not a thousands group («1500,50», «1.500,5»,
 *   «1500.5») is a decimal → rejected (never silently ×100).
 * - Spaces and «$» are ignored; any other non-digit («12a», «1_000», «+12»)
 *   is rejected (never silently dropped: «12a» is not 12).
 */
export function parseAmountInput(raw: string): AmountInputResult {
  const s = raw.replace(/[\s$]/g, "");
  if (s.includes(",")) return { error: AMOUNT_DECIMAL_MESSAGE };
  if (/[^0-9.]/.test(s)) return { error: AMOUNT_NOT_A_NUMBER_MESSAGE };
  let body = s;
  if (s.includes(".")) {
    if (!/^\d{1,3}(\.\d{3})+$/.test(s)) return { error: AMOUNT_DECIMAL_MESSAGE };
    body = s.replace(/\./g, "");
  }
  const digits = body;
  if (exceedsMaxCop(digits)) return { error: AMOUNT_TOO_LARGE_MESSAGE };
  return { digits };
}
