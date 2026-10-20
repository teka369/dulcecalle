import type { PayMethod } from "@/domain/types";
import { CASH_ERRORS } from "./copy";

export type CashAmountInput = {
  amountRaw: string;
  method: PayMethod | null | undefined;
};

export type GastoInput = CashAmountInput & {
  categoryRaw: string;
};

export function parseCopAmount(amountRaw: string): number | null {
  const raw = amountRaw.trim();
  if (raw === "") return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return null;
  return n;
}

export function validateCashAmount(input: CashAmountInput): string | null {
  const raw = input.amountRaw.trim();
  if (raw === "") return CASH_ERRORS.emptyAmount;
  const amount = parseCopAmount(input.amountRaw);
  if (amount == null) return CASH_ERRORS.emptyAmount;
  if (amount <= 0) return CASH_ERRORS.notPositive;
  if (input.method !== "Efectivo" && input.method !== "Nequi") {
    return CASH_ERRORS.noMethod;
  }
  return null;
}

export function validateGasto(input: GastoInput): string | null {
  const amountErr = validateCashAmount(input);
  if (amountErr) return amountErr;
  if (!input.categoryRaw.trim()) return CASH_ERRORS.emptyCategory;
  return null;
}

export function validateOpeningFloat(amountRaw: string): string | null {
  const raw = amountRaw.trim();
  if (raw === "") return null; // default 0
  const amount = parseCopAmount(amountRaw);
  if (amount == null) return CASH_ERRORS.emptyAmount;
  if (amount < 0) return CASH_ERRORS.openingNegative;
  return null;
}

export function validateCounted(amountRaw: string): string | null {
  const raw = amountRaw.trim();
  if (raw === "") return CASH_ERRORS.emptyCounted;
  const amount = parseCopAmount(amountRaw);
  if (amount == null) return CASH_ERRORS.badCounted;
  if (amount < 0) return CASH_ERRORS.badCounted;
  if (!Number.isInteger(amount)) return CASH_ERRORS.badCounted;
  return null;
}

/** Difference label: Contado − Esperado (Efectivo físico). */
export function differenceLabel(diff: number): string {
  if (diff === 0) return "Cuadra";
  if (diff < 0) return "Faltante";
  return "Sobrante";
}

export function differenceDetail(diff: number): string {
  if (diff === 0) return "Cuadra perfecto";
  if (diff < 0) return "Faltante";
  return "Sobrante";
}
