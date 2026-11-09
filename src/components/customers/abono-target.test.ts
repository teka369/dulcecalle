import { describe, expect, it } from "vitest";
import { buildAbonoPreview, wireTarget } from "./abono-target";
import type { OpenObligation } from "@/data/pwa/customer-allocations";
import { estimateOpen } from "@/data/pwa/customer-allocations";

const A: OpenObligation = { kind: "sale", id: "a", occurredOn: "2026-11-01", createdAt: 1, original: 1000, open: 1000, label: "Compra 1 nov" };
const B: OpenObligation = { kind: "sale", id: "b", occurredOn: "2026-11-02", createdAt: 2, original: 2000, open: 2000, label: "Compra 2 nov" };
const D: OpenObligation = { kind: "initial_debt", id: "d", occurredOn: "2026-10-01", createdAt: 0, original: 500, open: 500, label: "Deuda anterior 1 oct" };

describe("C04 W1 abono preview", () => {
  it("FIFO preview: oldest first (T2 shape)", () => {
    const p = buildAbonoPreview({ amount: 2000, debt: 3500, obligations: [D, A, B], choice: { mode: "fifo" }, overflow: "fifo" });
    expect(p.rows.map((r) => [r.key, r.before, r.after])).toEqual([
      ["initial_debt:d", 500, 0],
      ["sale:a", 1000, 0],
      ["sale:b", 2000, 1500],
    ]);
    expect(p.debtAfter).toBe(1500);
    expect(p.toCredit).toBe(0);
  });

  it("overpay shows the saldo a favor that will remain (T21)", () => {
    const p = buildAbonoPreview({ amount: 5000, debt: 3500, obligations: [D, A, B], choice: { mode: "fifo" }, overflow: "fifo" });
    expect(p.debtAfter).toBe(0);
    expect(p.toCredit).toBe(1500);
  });

  it("one sale with overflow credit", () => {
    const p = buildAbonoPreview({ amount: 1500, debt: 3500, obligations: [D, A, B], choice: { mode: "sale", obligationId: "a" }, overflow: "credit" });
    expect(p.rows.find((r) => r.key === "sale:a")?.after).toBe(0);
    expect(p.rows.find((r) => r.key === "initial_debt:d")?.after).toBe(500);
    expect(p.toCredit).toBe(500);
  });

  it("split validates against the open balance with the exact copy (T8)", () => {
    const p = buildAbonoPreview({ amount: 3000, debt: 3500, obligations: [D, A, B], choice: { mode: "split", amounts: { "sale:a": "1200" } }, overflow: "fifo" });
    expect(p.fieldErrors["sale:a"]).toMatch(/^No puede ser más que lo pendiente \(\$\s?1\.000\)\.$/);
  });

  it("wire target: FIFO omits target (C02 hash compatible)", () => {
    expect(wireTarget({ mode: "fifo" }, [A], "fifo")).toEqual({});
  });

  it("wire target: one local sale → saleRequestId + outbox dependency", () => {
    const local = { ...A, localRequestId: "rq", localOperationId: "op" };
    expect(wireTarget({ mode: "sale", obligationId: "a" }, [local], "credit")).toEqual({
      target: { mode: "sale", saleRequestId: "rq" },
      overflow: "credit",
      dependsOnOperationId: "op",
    });
  });

  it("wire target: split → saleId / initialDebtId", () => {
    expect(wireTarget({ mode: "split", amounts: { "sale:a": "300", "initial_debt:d": "200" } }, [D, A], "fifo")).toEqual({
      target: { mode: "split", targets: [{ initialDebtId: "d", amount: 200 }, { saleId: "a", amount: 300 }] },
    });
  });

  it("offline estimate puts the remaining debt on the newest obligations", () => {
    const est = estimateOpen([D, A, B], 2500);
    expect(est.map((o) => o.open)).toEqual([0, 500, 2000]);
  });
});
