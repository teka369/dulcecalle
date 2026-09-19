import { asCop, subCop } from "./money";

function max0(n: bigint): bigint {
  return n < 0n ? 0n : n;
}

function min3(a: bigint, b: bigint, c: bigint): bigint {
  let m = a < b ? a : b;
  if (c < m) m = c;
  return m;
}

/**
 * Same split as PWA `splitReturnSettlement`: fiada of THIS sale first,
 * never below customer.debt, leftover is a cash refund.
 */
export function splitReturnSettlement(input: {
  returnValue: bigint;
  saleCredit: bigint;
  alreadyDebtReduced: bigint;
  customerDebt: bigint;
}): { debtReduced: bigint; refundAmount: bigint } {
  const value = asCop(input.returnValue);
  if (value < 0n) {
    throw new Error("return value must be ≥ 0");
  }
  const remainingCredit = max0(
    subCop(asCop(input.saleCredit), asCop(input.alreadyDebtReduced)),
  );
  const debtCap = max0(asCop(input.customerDebt));
  const debtReduced = min3(value, remainingCredit, debtCap);
  const refundAmount = subCop(value, debtReduced);
  return { debtReduced, refundAmount };
}
