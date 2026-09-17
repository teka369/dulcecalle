import { asCop, addCop, subCop, mulCop } from "@/domain/money";

export const RETURN_ERRORS = {
  empty: "Elige qué se devuelve.",
  badQty: "La cantidad tiene que ser mayor a 0.",
  exceeds: "No se puede devolver más de lo vendido.",
  saleNotFound: "No encontramos esa venta.",
  lineNotFound: "Ese producto no está en la venta.",
  alreadyReturned: "Eso ya se devolvió.",
} as const;

export const RETURN_TOAST = "Devolución registrada";

/**
 * How a return of `returnValue` settles against this sale's remaining credit
 * and the customer's current debt. Leftover is a cash refund.
 *
 * Fiada first (the credit of THIS sale that has not already been reversed),
 * never below customer.debt. The rest leaves caja/Nequi.
 */
export function splitReturnSettlement(input: {
  returnValue: number;
  saleCredit: number;
  alreadyDebtReduced: number;
  customerDebt: number;
}): { debtReduced: number; refundAmount: number } {
  const value = asCop(input.returnValue);
  if (value < 0) throw new Error(RETURN_ERRORS.badQty);
  const remainingCredit = Math.max(
    0,
    subCop(asCop(input.saleCredit), asCop(input.alreadyDebtReduced)),
  );
  const debtCap = Math.max(0, asCop(input.customerDebt));
  const debtReduced = Math.min(value, remainingCredit, debtCap);
  const refundAmount = subCop(value, debtReduced);
  return { debtReduced, refundAmount };
}

export function returnLineValue(unitPrice: number, qty: number): number {
  return mulCop(asCop(unitPrice), qty);
}

export function returnLineMargin(unitPrice: number, unitCost: number, qty: number): number {
  return mulCop(subCop(asCop(unitPrice), asCop(unitCost)), qty);
}

export { addCop, subCop };
