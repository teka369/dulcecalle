import { asCop, subCop } from "./money";
import { fifoOrder, type Obligation } from "./allocation";

function max0(n: bigint): bigint {
  return n < 0n ? 0n : n;
}

function min3(a: bigint, b: bigint, c: bigint): bigint {
  let m = a < b ? a : b;
  if (c < m) m = c;
  return m;
}

export type ReturnRemainder = "refund" | "credit";

export type ReturnAllocationLine = {
  kind: Obligation["kind"];
  id: string;
  amount: bigint;
  openBefore: bigint;
  openAfter: bigint;
};

/**
 * Same split as PWA `splitReturnSettlement`.
 *
 * Legacy (no `obligations`): fiada of THIS sale first, never below
 * customer.debt, leftover is a cash refund.
 *
 * C04 / decision 6 (R6, SPEC §4.1) when `obligations` is given:
 * - debtReduced = min(value, customer.debt), applied first to the open
 *   balance of its own sale, then to the other open obligations by FIFO;
 * - rest = value − debtReduced;
 * - rest goes to `refund` (cash out) or `credit` (saldo a favor) as chosen.
 *   `remainderRequired` is true when rest > 0, the sale has a customer and no
 *   choice was sent (online → 422 REMAINDER_CHOICE_REQUIRED). Without a
 *   customer the rest is always a refund.
 */
export function splitReturnSettlement(input: {
  returnValue: bigint;
  saleCredit: bigint;
  alreadyDebtReduced: bigint;
  customerDebt: bigint;
  saleId?: string;
  obligations?: ReadonlyArray<Obligation>;
  hasCustomer?: boolean;
  remainder?: ReturnRemainder | null;
}): {
  debtReduced: bigint;
  refundAmount: bigint;
  toCredit: bigint;
  rest: bigint;
  remainderRequired: boolean;
  lines: ReturnAllocationLine[];
} {
  const value = asCop(input.returnValue);
  if (value < 0n) {
    throw new Error("return value must be ≥ 0");
  }
  if (!input.obligations) {
    const remainingCredit = max0(
      subCop(asCop(input.saleCredit), asCop(input.alreadyDebtReduced)),
    );
    const debtCap = max0(asCop(input.customerDebt));
    const debtReduced = min3(value, remainingCredit, debtCap);
    const refundAmount = subCop(value, debtReduced);
    return { debtReduced, refundAmount, toCredit: 0n, rest: refundAmount, remainderRequired: false, lines: [] };
  }
  const hasCustomer = input.hasCustomer !== false;
  const debtCap = hasCustomer ? max0(asCop(input.customerDebt)) : 0n;
  let left = value < debtCap ? value : debtCap;
  const lines: ReturnAllocationLine[] = [];
  const own = input.obligations.find((o) => o.kind === "sale" && o.id === input.saleId);
  const take = (o: Obligation) => {
    if (left <= 0n) return;
    const before = max0(o.open);
    const x = left < before ? left : before;
    if (x <= 0n) return;
    lines.push({ kind: o.kind, id: o.id, amount: x, openBefore: before, openAfter: before - x });
    left -= x;
  };
  if (own) take(own);
  for (const o of fifoOrder(input.obligations)) {
    if (own && o.kind === own.kind && o.id === own.id) continue;
    take(o);
  }
  let debtReduced = 0n;
  for (const l of lines) debtReduced += l.amount;
  const rest = value - debtReduced;
  const choice = hasCustomer ? input.remainder ?? null : "refund";
  const remainderRequired = rest > 0n && choice == null;
  const toCredit = rest > 0n && choice === "credit" ? rest : 0n;
  const refundAmount = rest > 0n && choice === "refund" ? rest : 0n;
  return { debtReduced, refundAmount, toCredit, rest, remainderRequired, lines };
}
