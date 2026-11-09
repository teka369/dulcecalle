import { describe, expect, it } from "vitest";
import {
  AllocationInvalidError,
  creditBySource,
  fifoOrder,
  openBalances,
  planAllocation,
  type Obligation,
} from "./allocation";
import { splitReturnSettlement } from "./sale/returns";

const sale = (id: string, day: string, original: number, open = original, createdAt = Date.parse(`${day}T12:00:00Z`)): Obligation => ({
  kind: "sale",
  id,
  occurredOn: day,
  createdAt,
  original,
  open,
});
const initial = (id: string, day: string, original: number, open = original): Obligation => ({
  kind: "initial_debt",
  id,
  occurredOn: day,
  createdAt: Date.parse(`${day}T08:00:00Z`),
  original,
  open,
});

const sum = (xs: Array<{ amount: number }>) => xs.reduce((a, b) => a + b.amount, 0);

describe("C04-PR1 allocation (pure, FE mirror)", () => {
  it("FIFO order is occurredOn, createdAt, id; initial debt enters by its own day", () => {
    const a = sale("b-id", "2026-11-02", 1);
    const b = sale("a-id", "2026-11-02", 1);
    const d = initial("d", "2026-10-01", 1);
    const c = sale("c", "2026-11-01", 1, 1, Date.parse("2026-11-05T00:00:00Z"));
    expect(fifoOrder([a, b, c, d]).map((o) => o.id)).toEqual(["d", "c", "a-id", "b-id"]);
  });

  it("T1 one fiada 3000 + abono 3000 → open 0, no credit", () => {
    const p = planAllocation({ amount: 3000, obligations: [sale("A", "2026-11-02", 3000)] });
    expect(p.lines).toEqual([{ targetType: "sale", id: "A", amount: 3000, openBefore: 3000, openAfter: 0, mode: "fifo" }]);
    expect(p.toCredit).toBe(0);
    expect(sum(p.lines)).toBe(3000);
  });

  it("T2 A 3000 (lunes) + B 2000 (martes), FIFO 4000 → A 3000, B 1000", () => {
    const p = planAllocation({ amount: 4000, obligations: [sale("B", "2026-11-03", 2000), sale("A", "2026-11-02", 3000)] });
    expect(p.lines.map((l) => [l.id, l.amount, l.openAfter])).toEqual([["A", 3000, 0], ["B", 1000, 1000]]);
    expect(p.toObligations).toBe(4000);
  });

  it("T3 partial sale (credit 4000) + abono 4000 → open 0", () => {
    const p = planAllocation({ amount: 4000, obligations: [sale("P", "2026-11-02", 4000)] });
    expect(p.lines[0]).toMatchObject({ id: "P", openAfter: 0 });
  });

  it("T4 initial 10000 (older) + sale 3000, abono 5000 → initial open 5000, sale 3000", () => {
    const p = planAllocation({ amount: 5000, obligations: [sale("S", "2026-11-02", 3000), initial("I", "2026-10-01", 10000)] });
    expect(p.lines).toEqual([{ targetType: "initial_debt", id: "I", amount: 5000, openBefore: 10000, openAfter: 5000, mode: "fifo" }]);
  });

  it("T5 abono to sale B with older A → B first, A untouched", () => {
    const p = planAllocation({
      amount: 1500,
      obligations: [sale("A", "2026-11-02", 3000), sale("B", "2026-11-03", 2000)],
      target: { mode: "sale", saleId: "B" },
    });
    expect(p.lines).toEqual([{ targetType: "sale", id: "B", amount: 1500, openBefore: 2000, openAfter: 500, mode: "explicit" }]);
  });

  it("R2 overflow: rest to FIFO by default, or credit when asked", () => {
    const obligations = [sale("A", "2026-11-02", 3000), sale("B", "2026-11-03", 2000)];
    const fifo = planAllocation({ amount: 2500, obligations, target: { mode: "sale", saleId: "B" } });
    expect(fifo.lines.map((l) => [l.targetType, l.id, l.amount])).toEqual([["sale", "B", 2000], ["sale", "A", 500]]);
    const credit = planAllocation({ amount: 2500, obligations, target: { mode: "sale", saleId: "B" }, overflow: "credit" });
    expect(credit.lines.map((l) => [l.targetType, l.id, l.amount])).toEqual([["sale", "B", 2000], ["credit", null, 500]]);
    expect(credit.toCredit).toBe(500);
  });

  it("T6 abono 6000 with debt 5000 → debt 0, credit 1000 (R4)", () => {
    const p = planAllocation({ amount: 6000, obligations: [sale("A", "2026-11-02", 5000)] });
    expect(p.toObligations).toBe(5000);
    expect(p.toCredit).toBe(1000);
    expect(p.lines.at(-1)).toMatchObject({ targetType: "credit", amount: 1000 });
  });

  it("no debt → everything is saldo a favor", () => {
    const p = planAllocation({ amount: 700, obligations: [] });
    expect(p.lines).toEqual([{ targetType: "credit", id: null, amount: 700, openBefore: 0, openAfter: 0, mode: "fifo" }]);
  });

  it("T7 split A 1000 + B 1000 with abono 2000 → two explicit lines", () => {
    const p = planAllocation({
      amount: 2000,
      obligations: [sale("A", "2026-11-02", 3000), sale("B", "2026-11-03", 2000)],
      target: { mode: "split", targets: [{ kind: "sale", id: "A", amount: 1000 }, { kind: "sale", id: "B", amount: 1000 }] },
    });
    expect(p.lines.map((l) => [l.id, l.amount, l.mode])).toEqual([["A", 1000, "explicit"], ["B", 1000, "explicit"]]);
    expect(p.toCredit).toBe(0);
  });

  it("T8 split asking more than A's open balance → ALLOCATION_INVALID", () => {
    expect(() =>
      planAllocation({
        amount: 5000,
        obligations: [sale("A", "2026-11-02", 3000, 1000)],
        target: { mode: "split", targets: [{ kind: "sale", id: "A", amount: 2000 }] },
      }),
    ).toThrow(AllocationInvalidError);
    expect(() =>
      planAllocation({
        amount: 500,
        obligations: [sale("A", "2026-11-02", 3000)],
        target: { mode: "split", targets: [{ kind: "sale", id: "A", amount: 1000 }] },
      }),
    ).toThrow(/repartido/);
  });

  it("§6.3 requested sale already settled → adjusted, money goes FIFO (or credit)", () => {
    const obligations = [sale("A", "2026-11-02", 3000), sale("B", "2026-11-03", 2000, 0)];
    const p = planAllocation({ amount: 1000, obligations, target: { mode: "sale", saleId: "B" } });
    expect(p.adjusted).toBe(true);
    expect(p.lines.map((l) => [l.id, l.amount])).toEqual([["A", 1000]]);
    const c = planAllocation({ amount: 1000, obligations, target: { mode: "sale", saleId: "B" }, overflow: "credit" });
    expect(c.adjusted).toBe(true);
    expect(c.toCredit).toBe(1000);
  });

  it("unknown sale → target_unknown", () => {
    expect(() => planAllocation({ amount: 1, obligations: [], target: { mode: "sale", saleId: "X" } })).toThrow(
      AllocationInvalidError,
    );
  });

  it("cap keeps legacy debt ≥ 0: beyond the stored debt goes to credit", () => {
    const p = planAllocation({ amount: 3000, obligations: [sale("A", "2026-11-02", 3000)], cap: 1000 });
    expect(p.toObligations).toBe(1000);
    expect(p.toCredit).toBe(2000);
  });

  it("T12 three consecutive abonos of 1000 over three sales accumulate FIFO", () => {
    let obligations = [sale("A", "2026-11-01", 1000), sale("B", "2026-11-02", 1000), sale("C", "2026-11-03", 1000)];
    const hit: string[] = [];
    for (let i = 0; i < 3; i++) {
      const p = planAllocation({ amount: 1000, obligations });
      hit.push(p.lines[0]!.id!);
      obligations = openBalances(
        obligations,
        p.lines.map((l) => ({ targetType: l.targetType, saleId: l.id, amount: l.amount })),
      ).map((o) => ({ ...o, original: o.open }));
    }
    expect(hit).toEqual(["A", "B", "C"]);
  });

  it("openBalances subtracts allocations per obligation", () => {
    const out = openBalances(
      [sale("A", "2026-11-02", 3000), initial("I", "2026-10-01", 500)],
      [
        { targetType: "sale", saleId: "A", amount: 1000 },
        { targetType: "initial_debt", initialDebtId: "I", amount: 500 },
        { targetType: "credit", amount: 99 },
      ],
    );
    expect(out.map((o) => o.open)).toEqual([2000, 0]);
  });

  it("creditBySource: positive adds, credit_apply releases, credit_refund consumes FIFO", () => {
    const rows = [
      { id: "1", sourceType: "payment", sourceId: "P1", targetType: "credit", amount: 1000, createdAt: 1 },
      { id: "2", sourceType: "sale_return", sourceId: "R1", targetType: "credit", amount: 500, createdAt: 2 },
      { id: "3", sourceType: "payment", sourceId: "P1", targetType: "credit", amount: -300, createdAt: 3 },
      { id: "4", sourceType: "credit_refund", sourceId: "M1", targetType: "credit", amount: -800, createdAt: 4 },
    ];
    expect(creditBySource(rows)).toEqual([{ sourceType: "sale_return", sourceId: "R1", available: 400 }]);
  });
});

describe("C04 splitReturnSettlement (decision 6)", () => {
  const obligations = [sale("OWN", "2026-11-02", 3000, 0), sale("OTHER", "2026-11-03", 2000)];

  it("T10 return 3000 of a settled fiada with another open 2000 → 2000 FIFO, rest by remainder", () => {
    const base = { returnValue: 3000, saleCredit: 3000, alreadyDebtReduced: 0, customerDebt: 2000, saleId: "OWN", obligations };
    const credit = splitReturnSettlement({ ...base, remainder: "credit" });
    expect(credit).toMatchObject({ debtReduced: 2000, refundAmount: 0, toCredit: 1000, rest: 1000, remainderRequired: false });
    expect(credit.lines).toEqual([{ kind: "sale", id: "OTHER", amount: 2000, openBefore: 2000, openAfter: 0 }]);
    expect(splitReturnSettlement({ ...base, remainder: "refund" })).toMatchObject({ refundAmount: 1000, toCredit: 0 });
    expect(splitReturnSettlement(base).remainderRequired).toBe(true);
  });

  it("T9 partial return of an open fiada goes to its own sale first", () => {
    const r = splitReturnSettlement({
      returnValue: 1000,
      saleCredit: 3000,
      alreadyDebtReduced: 0,
      customerDebt: 5000,
      saleId: "B",
      obligations: [sale("A", "2026-11-01", 2000), sale("B", "2026-11-02", 3000)],
    });
    expect(r.lines).toEqual([{ kind: "sale", id: "B", amount: 1000, openBefore: 3000, openAfter: 2000 }]);
    expect(r.rest).toBe(0);
  });

  it("T26 I-A5b value = debtReduced + refund + toCredit; walk-in is always refund", () => {
    for (const remainder of ["refund", "credit"] as const) {
      const r = splitReturnSettlement({
        returnValue: 3000, saleCredit: 0, alreadyDebtReduced: 0, customerDebt: 1200, saleId: "X",
        obligations: [sale("O", "2026-11-01", 1200)], remainder,
      });
      expect(r.debtReduced + r.refundAmount + r.toCredit).toBe(3000);
    }
    const walk = splitReturnSettlement({ returnValue: 900, saleCredit: 0, alreadyDebtReduced: 0, customerDebt: 0, obligations: [], hasCustomer: false });
    expect(walk).toMatchObject({ refundAmount: 900, toCredit: 0, remainderRequired: false });
  });
  it("C07: creditBySource follows the origin of reversal rows (mirror of the server)", () => {
    const rows = [
      { id: "a", sourceType: "payment", sourceId: "P", targetType: "credit", amount: 500, createdAt: 1 },
      { id: "b", sourceType: "reversal", sourceId: "R", originSourceType: "payment", originSourceId: "Q", targetType: "credit", amount: 3000, createdAt: 2 },
      { id: "c", sourceType: "reversal", sourceId: "R2", originSourceType: "payment", originSourceId: "P", targetType: "credit", amount: -500, createdAt: 3 },
    ];
    expect(creditBySource(rows)).toEqual([{ sourceType: "payment", sourceId: "Q", available: 3000 }]);
  });
});
