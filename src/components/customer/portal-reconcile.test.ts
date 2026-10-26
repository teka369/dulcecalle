import { describe, expect, it } from "vitest";
import type { CustomerLedger } from "@/data/http/customer-api";
import { customerPortalTotals, customerStatementRows } from "@/data/pwa/customer-portal";
import { statementSign } from "./portal";

/**
 * loop/v1 D1/D5/D6: ventas ≠ recibido ≠ fiado. Only the fiado part (and deuda
 * anterior) raises the debt; abonos and debt-reducing returns lower it. A paid
 * purchase or a cash refund never moves the debt.
 */
function ledger(): CustomerLedger {
  const sale = (id: string, saleTotal: number, amountReceived: number, credit: number, paymentKind: string, returns: unknown[] = [], at = 2) => ({
    id, paymentKind, method: "Efectivo", saleTotal, amountReceived, credit, note: null, occurredOn: "2026-10-01", createdAt: at, lines: [], returns,
  });
  const ret = (id: string, refundAmount: number, debtReduced: number) => ({
    id, refundAmount, debtReduced, method: refundAmount > 0 ? "Efectivo" : null, note: null, occurredOn: "2026-10-03", createdAt: 9, lines: [],
  });
  return {
    // 5.000 + 20.000 + 6.000 − 2.000 − 9.000 = 20.000
    customer: { id: "c1", code: "C-1", name: "Ana", debt: 20_000, createdAt: 1 },
    initials: [{ id: "i1", amount: 5_000, note: null, occurredOn: "2026-09-01", createdAt: 1 }],
    sales: [
      sale("paid", 45_000, 45_000, 0, "paid"),
      sale("fiado", 20_000, 0, 20_000, "credit", [ret("r-debt", 0, 2_000)], 3),
      sale("partial", 10_000, 4_000, 6_000, "partial", [], 4),
      sale("paid-refund", 8_000, 8_000, 0, "paid", [ret("r-cash", 3_000, 0)], 5),
    ],
    payments: [{ id: "p1", amount: 9_000, method: "Nequi", occurredOn: "2026-10-04", createdAt: 10 }],
  } as unknown as CustomerLedger;
}

const signed = (l: CustomerLedger) =>
  customerStatementRows(l).reduce((sum, row) => {
    const s = statementSign(row).sign;
    return s === "+" ? sum + row.amount : s === "−" ? sum - row.amount : sum;
  }, 0);

describe("portal statement reconciles with DEBES (D1/D5/D6)", () => {
  it("D1: a cash-paid purchase is neutral «Pagada», never «+ · Sube tu deuda»", () => {
    const row = customerStatementRows(ledger()).find((r) => r.id === "sale-paid")!;
    const sg = statementSign(row);
    expect(sg.word).not.toBe("Sube tu deuda");
    expect(sg).toMatchObject({ sign: "", word: "Pagada", tone: "neutral" });
  });

  it("D5: a cash refund (debtReduced 0) is not «Baja tu deuda»", () => {
    const rows = customerStatementRows(ledger()).filter((r) => r.id.startsWith("dev-r-cash"));
    expect(rows).toHaveLength(1);
    expect(statementSign(rows[0]).word).not.toBe("Baja tu deuda");
    expect(statementSign(rows[0])).toMatchObject({ sign: "", tone: "neutral" });
    expect(rows[0].amount).toBe(3_000);
  });

  it("a debt-reducing return still reads «− · Baja tu deuda»", () => {
    const row = customerStatementRows(ledger()).find((r) => r.id === "dev-r-debt")!;
    expect(statementSign(row)).toMatchObject({ sign: "−", word: "Baja tu deuda" });
    expect(row.amount).toBe(2_000);
  });

  it("signed rows add up to DEBES", () => {
    const l = ledger();
    expect(signed(l)).toBe(l.customer.debt);
  });

  it("D6: home totals reconcile — fiado − abonos − devoluciones = DEBES", () => {
    const l = ledger();
    const t = customerPortalTotals(l);
    expect(t).toMatchObject({ totalFiado: 31_000, totalAbonado: 9_000, totalDevuelto: 2_000 });
    expect(t.totalFiado - t.totalAbonado - t.totalDevuelto).toBe(l.customer.debt);
  });
});
