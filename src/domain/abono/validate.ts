import type { PayMethod } from "@/domain/types";

/** Exact Escritor / Designer S2 error strings. */
export const ABONO_ERRORS = {
  empty: "Escribe cuánto abona.",
  notPositive: "El abono tiene que ser mayor a 0.",
  exceedsDebt: "El abono no puede ser mayor al saldo.",
  noMethod: "Elige Efectivo o Nequi.",
} as const;

export const CUSTOMER_ERRORS = {
  emptyName: "Ponle un nombre para guardarlo.",
} as const;

export type AbonoInput = {
  /** Raw field; empty string → empty error. */
  amountRaw: string;
  debt: number;
  method: PayMethod | null | undefined;
};

/**
 * Validate abono form/domain input.
 * Returns exact UI error string, or null if valid.
 */
export function validateAbono(input: AbonoInput): string | null {
  const raw = input.amountRaw.trim();
  if (raw === "") return ABONO_ERRORS.empty;

  const amount = Number.parseInt(raw, 10);
  if (!Number.isFinite(amount) || Number.isNaN(amount)) {
    return ABONO_ERRORS.empty;
  }
  if (amount <= 0) return ABONO_ERRORS.notPositive;
  if (amount > input.debt) return ABONO_ERRORS.exceedsDebt;
  if (input.method !== "Efectivo" && input.method !== "Nequi") {
    return ABONO_ERRORS.noMethod;
  }
  return null;
}

/** Remaining debt helper copy after a proposed abono amount. */
export function abonoRemainingHelper(debt: number, amount: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0 || amount > debt) return null;
  if (amount === debt) return "Queda en $ 0";
  const remaining = debt - amount;
  const formatted = new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(remaining);
  return `Queda debiendo ${formatted}`;
}

export function parseAbonoAmount(amountRaw: string): number {
  return Number.parseInt(amountRaw.trim(), 10);
}
