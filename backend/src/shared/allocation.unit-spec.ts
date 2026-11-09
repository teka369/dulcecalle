import {
  AllocationInvalidError,
  creditBySource,
  fifoOrder,
  planAllocation,
  type Obligation,
} from "./allocation";
import { splitReturnSettlement } from "./returns";

const sale = (id: string, day: string, original: bigint, open = original, createdAt = Date.parse(`${day}T12:00:00Z`)): Obligation => ({
  kind: "sale", id, occurredOn: day, createdAt, original, open,
});
const initial = (id: string, day: string, original: bigint): Obligation => ({
  kind: "initial_debt", id, occurredOn: day, createdAt: Date.parse(`${day}T08:00:00Z`), original, open: original,
});

describe("C04-PR1 allocation (pure, API mirror — same cases as src/domain/allocation.test.ts)", () => {
  it("FIFO order", () => {
    expect(
      fifoOrder([sale("b-id", "2026-11-02", 1n), sale("a-id", "2026-11-02", 1n), initial("d", "2026-10-01", 1n)]).map((o) => o.id),
    ).toEqual(["d", "a-id", "b-id"]);
  });
  it("T1/T2/T4/T6", () => {
    expect(planAllocation({ amount: 3000n, obligations: [sale("A", "2026-11-02", 3000n)] }).lines[0]).toMatchObject({ openAfter: 0n });
    const t2 = planAllocation({ amount: 4000n, obligations: [sale("B", "2026-11-03", 2000n), sale("A", "2026-11-02", 3000n)] });
    expect(t2.lines.map((l) => [l.id, l.amount])).toEqual([["A", 3000n], ["B", 1000n]]);
    const t4 = planAllocation({ amount: 5000n, obligations: [sale("S", "2026-11-02", 3000n), initial("I", "2026-10-01", 10000n)] });
    expect(t4.lines).toEqual([{ targetType: "initial_debt", id: "I", amount: 5000n, openBefore: 10000n, openAfter: 5000n, mode: "fifo" }]);
    const t6 = planAllocation({ amount: 6000n, obligations: [sale("A", "2026-11-02", 5000n)] });
    expect([t6.toObligations, t6.toCredit]).toEqual([5000n, 1000n]);
  });
  it("T5/T7/T8 and §6.3 adjusted", () => {
    const obligations = [sale("A", "2026-11-02", 3000n), sale("B", "2026-11-03", 2000n)];
    expect(planAllocation({ amount: 1500n, obligations, target: { mode: "sale", saleId: "B" } }).lines.map((l) => l.id)).toEqual(["B"]);
    const t7 = planAllocation({
      amount: 2000n, obligations,
      target: { mode: "split", targets: [{ kind: "sale", id: "A", amount: 1000n }, { kind: "sale", id: "B", amount: 1000n }] },
    });
    expect(t7.lines.map((l) => [l.id, l.amount])).toEqual([["A", 1000n], ["B", 1000n]]);
    expect(() =>
      planAllocation({ amount: 9000n, obligations, target: { mode: "split", targets: [{ kind: "sale", id: "B", amount: 2500n }] } }),
    ).toThrow(AllocationInvalidError);
    const adj = planAllocation({ amount: 1000n, obligations: [sale("A", "2026-11-02", 3000n), sale("B", "2026-11-03", 2000n, 0n)], target: { mode: "sale", saleId: "B" } });
    expect(adj.adjusted).toBe(true);
    expect(adj.lines.map((l) => l.id)).toEqual(["A"]);
  });
  it("creditBySource", () => {
    expect(
      creditBySource([
        { id: "1", sourceType: "payment", sourceId: "P1", targetType: "credit", amount: 1000n, createdAt: 1 },
        { id: "2", sourceType: "credit_refund", sourceId: "M", targetType: "credit", amount: -400n, createdAt: 2 },
      ]),
    ).toEqual([{ sourceType: "payment", sourceId: "P1", available: 600n }]);
  });
  it("returns: T10 and walk-in", () => {
    const r = splitReturnSettlement({
      returnValue: 3000n, saleCredit: 3000n, alreadyDebtReduced: 0n, customerDebt: 2000n, saleId: "OWN",
      obligations: [sale("OWN", "2026-11-02", 3000n, 0n), sale("OTHER", "2026-11-03", 2000n)], remainder: "credit",
    });
    expect([r.debtReduced, r.toCredit, r.refundAmount]).toEqual([2000n, 1000n, 0n]);
    const legacy = splitReturnSettlement({ returnValue: 500n, saleCredit: 0n, alreadyDebtReduced: 0n, customerDebt: 0n });
    expect(legacy.refundAmount).toBe(500n);
  });
});
