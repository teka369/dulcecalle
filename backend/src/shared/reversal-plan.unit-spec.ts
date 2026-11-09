import type { Obligation } from "./allocation";
import { creditBySource } from "./allocation";
import { planPaymentReversal, planSaleVoid, ReversalPlanError, type AllocRow } from "./reversal-plan";

let n = 0;
const row = (o: Partial<AllocRow> & Pick<AllocRow, "sourceType" | "sourceId" | "targetType" | "amount">): AllocRow => ({
  id: `r${String(++n).padStart(4, "0")}`,
  saleId: null,
  initialDebtId: null,
  mode: "fifo",
  createdAt: n,
  originSourceType: null,
  originSourceId: null,
  ...o,
});
const sale = (id: string, original: bigint, open: bigint, day = "2026-11-01", at = 1): Obligation => ({
  kind: "sale",
  id,
  occurredOn: day,
  createdAt: at,
  original,
  open,
});
const sum = (xs: Array<{ amount: bigint }>) => xs.reduce((a, x) => a + x.amount, 0n);

describe("C07 reversal planner (pure)", () => {
  it("T10: reversing a FIFO payment of 5000 (A 3000, B 2000) reopens both, debt +5000", () => {
    const rows = [
      row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "A", amount: 3000n }),
      row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "B", amount: 2000n }),
    ];
    const plan = planPaymentReversal({ paymentId: "P", rows, obligations: [sale("A", 3000n, 0n), sale("B", 2000n, 0n, "2026-11-02")], creditBalance: 0n });
    expect(plan.lines.map((l) => [l.id, l.amount, l.originSourceId])).toEqual([["A", -3000n, "P"], ["B", -2000n, "P"]]);
    expect(plan.debtDelta).toBe(5000n);
    expect(plan.creditDelta).toBe(0n);
  });

  it("M12: payment 2000 on a 5000 fiada → debt back +2000", () => {
    const rows = [row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "A", amount: 2000n })];
    const plan = planPaymentReversal({ paymentId: "P", rows, obligations: [sale("A", 5000n, 3000n)], creditBalance: 0n });
    expect(plan.debtDelta).toBe(2000n);
  });

  it("surplus still in saldo a favor leaves it (credit −x), no debt change", () => {
    const rows = [
      row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "A", amount: 1000n }),
      row({ sourceType: "payment", sourceId: "P", targetType: "credit", amount: 500n }),
    ];
    const plan = planPaymentReversal({ paymentId: "P", rows, obligations: [sale("A", 1000n, 0n)], creditBalance: 500n });
    expect(plan.debtDelta).toBe(1000n);
    expect(plan.creditDelta).toBe(-500n);
  });

  it("T11: saldo a favor of the payment already applied to another sale (pair attributed to P) → that sale reopens", () => {
    const rows = [
      row({ sourceType: "payment", sourceId: "P", targetType: "credit", amount: 1000n }),
      row({ sourceType: "payment", sourceId: "P", targetType: "credit", amount: -1000n, mode: "credit_apply" }),
      row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "X", amount: 1000n, mode: "credit_apply" }),
    ];
    const plan = planPaymentReversal({ paymentId: "P", rows, obligations: [sale("X", 1000n, 0n)], creditBalance: 0n });
    expect(plan.lines.map((l) => [l.targetType, l.id, l.amount])).toEqual([["sale", "X", -1000n]]);
    expect(plan.debtDelta).toBe(1000n);
    expect(plan.creditDelta).toBe(0n);
  });

  it("T11b: credit short because another source's credit was applied → undo newest credit_apply first", () => {
    // Q (older) 1000 credit, P 1000 credit; apply 1000 attributed to Q; refund 1000 (FIFO consumes P)
    const rows = [
      row({ sourceType: "payment", sourceId: "Q", targetType: "credit", amount: 1000n }),
      row({ sourceType: "payment", sourceId: "P", targetType: "credit", amount: 1000n }),
      row({ sourceType: "payment", sourceId: "Q", targetType: "credit", amount: -1000n, mode: "credit_apply" }),
      row({ sourceType: "payment", sourceId: "Q", targetType: "sale", saleId: "X", amount: 1000n, mode: "credit_apply" }),
      row({ sourceType: "credit_refund", sourceId: "F", targetType: "credit", amount: -1000n, mode: "explicit" }),
    ];
    const plan = planPaymentReversal({ paymentId: "P", rows, obligations: [sale("X", 1000n, 0n)], creditBalance: 0n });
    expect(plan.lines.map((l) => [l.kind, l.targetType, l.id, l.amount, l.originSourceId])).toEqual([
      ["unapply", "sale", "X", -1000n, "Q"],
      ["unapply", "credit", null, 1000n, "Q"],
      ["credit_out", "credit", null, -1000n, "P"],
    ]);
    expect(plan.debtDelta).toBe(1000n);
    expect(plan.creditDelta).toBe(0n);
  });

  it("credit refunded in cash and nothing to undo → credit_already_refunded (never credit_balance < 0)", () => {
    const rows = [
      row({ sourceType: "payment", sourceId: "P", targetType: "credit", amount: 1000n }),
      row({ sourceType: "credit_refund", sourceId: "F", targetType: "credit", amount: -1000n, mode: "explicit" }),
    ];
    expect(() => planPaymentReversal({ paymentId: "P", rows, obligations: [], creditBalance: 0n })).toThrow(ReversalPlanError);
  });

  it("a payment already released by a sale void (reimputed to B) reopens B, not the voided sale", () => {
    const rows = [
      row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "A", amount: 3000n }),
      row({ sourceType: "reversal", sourceId: "R1", originSourceType: "payment", originSourceId: "P", targetType: "sale", saleId: "A", amount: -3000n, mode: "reversal" }),
      row({ sourceType: "reversal", sourceId: "R1", originSourceType: "payment", originSourceId: "P", targetType: "sale", saleId: "B", amount: 2000n, mode: "reversal" }),
      row({ sourceType: "reversal", sourceId: "R1", originSourceType: "payment", originSourceId: "P", targetType: "credit", amount: 1000n, mode: "reversal" }),
      row({ sourceType: "reversal", sourceId: "R1", targetType: "sale", saleId: "A", amount: 3000n, mode: "reversal" }),
    ];
    const plan = planPaymentReversal({ paymentId: "P", rows, obligations: [sale("A", 3000n, 0n), sale("B", 2000n, 0n)], creditBalance: 1000n });
    expect(plan.lines.map((l) => [l.targetType, l.id, l.amount])).toEqual([["sale", "B", -2000n], ["credit", null, -1000n]]);
    expect(plan.debtDelta).toBe(2000n);
  });

  it("T1/T2: paid sale without customer → cashOut = received, no rows", () => {
    const p = planSaleVoid({ saleId: "S", hasCustomer: false, remainingValue: 2000n, cashNet: 2000n, rows: [], obligations: [], ownReturnIds: new Set() });
    expect(p.lines).toEqual([]);
    expect(p.cashOut).toBe(2000n);
  });

  it("T6: fiada 3000 without payments → debt −3000, no cash", () => {
    const p = planSaleVoid({ saleId: "S", hasCustomer: true, remainingValue: 3000n, cashNet: 0n, rows: [], obligations: [sale("S", 3000n, 3000n)], ownReturnIds: new Set() });
    expect(p.debtDelta).toBe(-3000n);
    expect(p.cashOut).toBe(0n);
    expect(p.lines.map((l) => [l.kind, l.amount])).toEqual([["close", 3000n]]);
  });

  it("T7: fiada 3000 paid by an abono 3000, no other debt → debt 0, saldo a favor +3000, no cash", () => {
    const rows = [row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "S", amount: 3000n })];
    const p = planSaleVoid({ saleId: "S", hasCustomer: true, remainingValue: 3000n, cashNet: 0n, rows, obligations: [sale("S", 3000n, 0n)], ownReturnIds: new Set() });
    expect(p.debtDelta).toBe(0n);
    expect(p.creditDelta).toBe(3000n);
    expect(p.cashOut).toBe(0n);
    expect(sum(p.lines.filter((l) => l.originSourceId === "P"))).toBe(0n);
  });

  it("T8: same with another open fiada of 2000 → it goes to 0 and saldo a favor 1000", () => {
    const rows = [row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "S", amount: 3000n })];
    const p = planSaleVoid({ saleId: "S", hasCustomer: true, remainingValue: 3000n, cashNet: 0n, rows, obligations: [sale("S", 3000n, 0n), sale("B", 2000n, 2000n, "2026-11-02")], ownReturnIds: new Set() });
    expect(p.debtDelta).toBe(-2000n);
    expect(p.creditDelta).toBe(1000n);
    expect(p.lines.filter((l) => l.kind === "reimpute").map((l) => [l.targetType, l.id, l.amount])).toEqual([["sale", "B", 2000n], ["credit", null, 1000n]]);
  });

  it("T33: paid 3×1000 Efectivo with a prior refund of 1000 → cashOut 2000", () => {
    const p = planSaleVoid({ saleId: "S", hasCustomer: false, remainingValue: 2000n, cashNet: 2000n, rows: [], obligations: [], ownReturnIds: new Set() });
    expect(p.cashOut).toBe(2000n);
  });

  it("T34: fiada 3000, return 1000 (debtReduced) and abono 1000 → abono to saldo a favor, sale closed, return untouched", () => {
    const rows = [
      row({ sourceType: "sale_return", sourceId: "RET", targetType: "sale", saleId: "S", amount: 1000n, mode: "explicit" }),
      row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "S", amount: 1000n }),
    ];
    const p = planSaleVoid({ saleId: "S", hasCustomer: true, remainingValue: 2000n, cashNet: 0n, rows, obligations: [sale("S", 3000n, 1000n)], ownReturnIds: new Set(["RET"]) });
    expect(p.released).toBe(1000n);
    expect(p.creditDelta).toBe(1000n);
    expect(p.debtDelta).toBe(-1000n);
    expect(p.lines.some((l) => l.originSourceId === "RET")).toBe(false);
  });

  it("over-release cap: fiada paid in full, then a return to saldo a favor → release only the value not given back", () => {
    const rows = [row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "S", amount: 3000n })];
    const p = planSaleVoid({ saleId: "S", hasCustomer: true, remainingValue: 2000n, cashNet: 0n, rows, obligations: [sale("S", 3000n, 0n)], ownReturnIds: new Set(["RET"]) });
    expect(p.released).toBe(2000n);
    expect(p.creditDelta).toBe(2000n);
  });

  it("partial sale 6000 (2000 Nequi, credit 4000) with an abono 1000 → releases 1000, cashOut 2000", () => {
    const rows = [row({ sourceType: "payment", sourceId: "P", targetType: "sale", saleId: "S", amount: 1000n })];
    const p = planSaleVoid({ saleId: "S", hasCustomer: true, remainingValue: 6000n, cashNet: 2000n, rows, obligations: [sale("S", 4000n, 3000n)], ownReturnIds: new Set() });
    expect(p.released).toBe(1000n);
    expect(p.cashOut).toBe(2000n);
    expect(p.debtDelta).toBe(-3000n);
    expect(p.creditDelta).toBe(1000n);
  });

  it("T35: nothing left to void → nothing_to_void", () => {
    expect(() => planSaleVoid({ saleId: "S", hasCustomer: false, remainingValue: 0n, cashNet: 0n, rows: [], obligations: [], ownReturnIds: new Set() })).toThrow(ReversalPlanError);
  });

  it("creditBySource follows the origin of reversal rows (released money is available again)", () => {
    const rows = [
      { id: "a", sourceType: "payment", sourceId: "P", targetType: "credit", amount: 500n, createdAt: 1 },
      { id: "b", sourceType: "reversal", sourceId: "R", originSourceType: "payment", originSourceId: "Q", targetType: "credit", amount: 3000n, createdAt: 2 },
      { id: "c", sourceType: "reversal", sourceId: "R2", originSourceType: "payment", originSourceId: "P", targetType: "credit", amount: -500n, createdAt: 3 },
    ];
    expect(creditBySource(rows)).toEqual([{ sourceType: "payment", sourceId: "Q", available: 3000n }]);
  });
});
