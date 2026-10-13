import { addCop, mulCop, subCop } from "@/domain/money";
import type { PayMethod, PaymentKind } from "@/domain/types";

/**
 * Pure checkout rules for /ventas/cobrar (presentation layer; same rules the
 * page applied inline before P1). Defaults = Pagada + Efectivo, so a cash sale
 * needs no extra choice: Cobrar (cart) → Registrar = 2 taps.
 */
export type CheckoutState = {
  paymentKind: PaymentKind;
  method: PayMethod;
  customerId: string | null;
  /** Digits typed for Parcial (abono). */
  abonoInput: string;
};

export type CheckoutLine = { productId: string; qty: number; unitPrice: number };

/** Mirrors cartStore emptyFields(): a fresh cart starts as Pagada + Efectivo. */
export const CHECKOUT_DEFAULTS: CheckoutState = {
  paymentKind: "paid",
  method: "Efectivo",
  customerId: null,
  abonoInput: "",
};

export type CheckoutAction =
  | { type: "kind"; kind: PaymentKind }
  | { type: "method"; method: PayMethod }
  | { type: "customer"; customerId: string | null }
  | { type: "abono"; digits: string };

export function checkoutReducer(s: CheckoutState, a: CheckoutAction): CheckoutState {
  switch (a.type) {
    case "kind":
      return {
        ...s,
        paymentKind: a.kind,
        customerId: a.kind === "paid" ? null : s.customerId,
        abonoInput: a.kind === "partial" ? s.abonoInput : "",
      };
    case "method":
      return { ...s, method: a.method };
    case "customer":
      return { ...s, customerId: a.customerId };
    case "abono":
      return { ...s, abonoInput: a.digits.replace(/\D/g, "") };
  }
}

export function linesTotal(lines: ReadonlyArray<CheckoutLine>): number {
  return lines.reduce((sum, l) => addCop(sum, mulCop(l.unitPrice, l.qty)), 0);
}

export function abonoOf(s: CheckoutState): number {
  return Number.parseInt(s.abonoInput || "0", 10) || 0;
}

/** Money received now (recibido). Never equals «ventas» unless Pagada. */
export function receivedFor(s: CheckoutState, total: number): number {
  if (s.paymentKind === "paid") return total;
  if (s.paymentKind === "partial") return abonoOf(s);
  return 0;
}

/** Amount left on credit (fiado) by this sale. */
export function fiadoFor(s: CheckoutState, total: number): number {
  if (s.paymentKind === "credit") return total;
  if (s.paymentKind === "partial") {
    const a = abonoOf(s);
    return a > 0 && a < total ? subCop(total, a) : 0;
  }
  return 0;
}

export function canRegister(s: CheckoutState, total: number, lineCount: number): boolean {
  if (total <= 0 || lineCount === 0) return false;
  if (s.paymentKind === "paid") return true;
  if (s.paymentKind === "partial") {
    const a = abonoOf(s);
    return a > 0 && a < total && s.customerId != null;
  }
  return s.customerId != null;
}

/** Shows the method choice only when money is received (not in Fiada). */
export function showsMethod(s: CheckoutState): boolean {
  return s.paymentKind !== "credit";
}

export type SaleRequest = {
  lines: CheckoutLine[];
  paymentKind: PaymentKind;
  customerId?: string;
  amountReceived: number;
  method?: PayMethod;
  note?: string;
};

/** Same payload the page sent before (createSaleWithOfflineFallback input). */
export function buildSaleRequest(
  s: CheckoutState,
  lines: ReadonlyArray<CheckoutLine>,
  note: string,
): SaleRequest {
  const total = linesTotal(lines);
  const received = receivedFor(s, total);
  const trimmed = note.trim();
  return {
    lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice })),
    paymentKind: s.paymentKind,
    customerId: s.paymentKind === "paid" ? undefined : (s.customerId ?? undefined),
    amountReceived: received,
    method: received > 0 ? s.method : undefined,
    ...(trimmed ? { note: trimmed } : {}),
  };
}

/**
 * Taps from the cart to a registered sale: 1 (Cobrar) + choices that differ
 * from the defaults + 1 (Registrar). Customer/abono add their own steps.
 */
export function tapsFromCart(target: Pick<CheckoutState, "paymentKind" | "method">): number {
  let taps = 1; // Cobrar
  if (target.paymentKind !== CHECKOUT_DEFAULTS.paymentKind) taps++;
  if (target.paymentKind !== "credit" && target.method !== CHECKOUT_DEFAULTS.method) taps++;
  return taps + 1; // Registrar
}

export type SalesSummaryRow = { saleTotal: number; amountReceived: number; credit: number };

/** Hero totals for /ventas: kept separate (ventas ≠ recibido ≠ fiado; no caja). */
export function summarizeSales(rows: ReadonlyArray<SalesSummaryRow>): {
  ventas: number;
  recibido: number;
  fiado: number;
  count: number;
} {
  let ventas = 0;
  let recibido = 0;
  let fiado = 0;
  for (const r of rows) {
    ventas = addCop(ventas, r.saleTotal);
    recibido = addCop(recibido, r.amountReceived);
    fiado = addCop(fiado, r.credit);
  }
  return { ventas, recibido, fiado, count: rows.length };
}
