import type { PayMethod } from "@/domain/types";
import { AMOUNT_TOO_LARGE_MESSAGE, exceedsMaxCop } from "@/domain/money/limits";

/** Exact Escritor / Designer S2 error strings. */
export const ABONO_ERRORS = {
  empty: "Escribe cuánto abona.",
  notPositive: "El abono tiene que ser mayor a 0.",
  /**
   * Pre-C04 copy, kept only to map an old server's 409 ABONO_EXCEEDS_DEBT.
   * Since C04 (R4) an abono above the debt is valid: the excess becomes
   * saldo a favor.
   */
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
  if (exceedsMaxCop(raw)) return AMOUNT_TOO_LARGE_MESSAGE;

  const amount = Number.parseInt(raw, 10);
  if (!Number.isFinite(amount) || Number.isNaN(amount)) {
    return ABONO_ERRORS.empty;
  }
  if (amount <= 0) return ABONO_ERRORS.notPositive;
  // C04 R4 — amount > debt is allowed: the excess is saldo a favor.
  if (input.method !== "Efectivo" && input.method !== "Nequi") {
    return ABONO_ERRORS.noMethod;
  }
  return null;
}

/** Remaining debt helper copy after a proposed abono amount. */
export function abonoRemainingHelper(debt: number, amount: number): string | null {
  if (!Number.isInteger(amount) || amount <= 0) return null;
  if (amount > debt) return `Sobran ${formatPesos(amount - Math.max(0, debt))}: quedan como saldo a favor.`;
  if (amount === debt) return "Queda en $ 0";
  return `Queda debiendo ${formatPesos(debt - amount)}`;
}

function formatPesos(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/** C04 R4 — the part of an abono that will become saldo a favor (estimate). */
export function abonoExcess(debt: number, amount: number): number {
  if (!Number.isInteger(amount) || amount <= 0) return 0;
  return Math.max(0, amount - Math.max(0, debt));
}

export function parseAbonoAmount(amountRaw: string): number {
  return Number.parseInt(amountRaw.trim(), 10);
}
