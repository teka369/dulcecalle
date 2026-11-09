import { asCop, addCop, subCop, mulCop } from "@/domain/money";
import { fifoOrder, type Obligation } from "@/domain/allocation";

export const RETURN_ERRORS = {
  empty: "Elige qué se devuelve.",
  badQty: "La cantidad tiene que ser mayor a 0.",
  exceeds: "No se puede devolver más de lo vendido.",
  saleNotFound: "No encontramos esa venta.",
  lineNotFound: "Ese producto no está en la venta.",
  alreadyReturned: "Eso ya se devolvió.",
} as const;

export const RETURN_TOAST = "Devolución registrada";

export type ReturnRemainder = "refund" | "credit";

export type ReturnAllocationLine = {
  kind: Obligation["kind"];
  id: string;
  amount: number;
  openBefore: number;
  openAfter: number;
};

/**
 * How a return of `returnValue` settles. Mirror of the API
 * `backend/src/shared/returns.ts` (bigint there, number here).
 *
 * Legacy (no `obligations`): fiada of THIS sale first (the credit that has not
 * already been reversed), never below customer.debt; the rest is a refund.
 *
 * C04 / decision 6 (R6) when `obligations` is given: debtReduced =
 * min(value, customer.debt), first to the open balance of its own sale, then
 * to the other open obligations by FIFO. The rest goes to `refund` or `credit`
 * (saldo a favor). `remainderRequired` = rest > 0 with a customer and no
 * choice. Without a customer the rest is always a refund.
 */
export function splitReturnSettlement(input: {
  returnValue: number;
  saleCredit: number;
  alreadyDebtReduced: number;
  customerDebt: number;
  saleId?: string;
  obligations?: ReadonlyArray<Obligation>;
  hasCustomer?: boolean;
  remainder?: ReturnRemainder | null;
}): {
  debtReduced: number;
  refundAmount: number;
  toCredit: number;
  rest: number;
  remainderRequired: boolean;
  lines: ReturnAllocationLine[];
} {
  const value = asCop(input.returnValue);
  if (value < 0) throw new Error(RETURN_ERRORS.badQty);
  if (!input.obligations) {
    const remainingCredit = Math.max(
      0,
      subCop(asCop(input.saleCredit), asCop(input.alreadyDebtReduced)),
    );
    const debtCap = Math.max(0, asCop(input.customerDebt));
    const debtReduced = Math.min(value, remainingCredit, debtCap);
    const refundAmount = subCop(value, debtReduced);
    return { debtReduced, refundAmount, toCredit: 0, rest: refundAmount, remainderRequired: false, lines: [] };
  }
  const hasCustomer = input.hasCustomer !== false;
  const debtCap = hasCustomer ? Math.max(0, asCop(input.customerDebt)) : 0;
  let left = Math.min(value, debtCap);
  const lines: ReturnAllocationLine[] = [];
  const own = input.obligations.find((o) => o.kind === "sale" && o.id === input.saleId);
  const take = (o: Obligation) => {
    if (left <= 0) return;
    const before = Math.max(0, o.open);
    const x = Math.min(left, before);
    if (x <= 0) return;
    lines.push({ kind: o.kind, id: o.id, amount: x, openBefore: before, openAfter: before - x });
    left -= x;
  };
  if (own) take(own);
  for (const o of fifoOrder(input.obligations)) {
    if (own && o.kind === own.kind && o.id === own.id) continue;
    take(o);
  }
  let debtReduced = 0;
  for (const l of lines) debtReduced += l.amount;
  const rest = value - debtReduced;
  const choice = hasCustomer ? input.remainder ?? null : "refund";
  const remainderRequired = rest > 0 && choice == null;
  const toCredit = rest > 0 && choice === "credit" ? rest : 0;
  const refundAmount = rest > 0 && choice === "refund" ? rest : 0;
  return { debtReduced, refundAmount, toCredit, rest, remainderRequired, lines };
}

export function returnLineValue(unitPrice: number, qty: number): number {
  return mulCop(asCop(unitPrice), qty);
}

export function returnLineMargin(unitPrice: number, unitCost: number, qty: number): number {
  return mulCop(subCop(asCop(unitPrice), asCop(unitCost)), qty);
}

export { addCop, subCop };
