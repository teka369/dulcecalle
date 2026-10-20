import type {
  CustomerLedger,
  CustomerLedgerSale,
} from "../http/customer-api";

export type CustomerStatementRow = {
  id: string;
  at: number;
  occurredOn: string;
  /** compra = paid at the moment; reembolso = money handed back. Neither moves the debt. */
  kind: "compra" | "pago" | "fiado" | "inicial" | "devolucion" | "reembolso";
  title: string;
  amount: number;
  href?: string;
};

function epoch(value: string | number): number {
  if (typeof value === "number") return value;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/** UI grouping only. Saldo comes from `ledger.customer.debt` (server). */
export function customerPortalSummary(ledger: CustomerLedger) {
  return {
    name: ledger.customer.name,
    code: ledger.customer.code,
    debt: ledger.customer.debt,
    purchases: ledger.sales.length,
    payments: ledger.payments.length,
    credits: ledger.sales.filter((s) => s.credit > 0).length,
  };
}

/**
 * Ledger sums for the customer home. Derived only, never invented.
 *
 * Domain rule: ventas ≠ recibido ≠ fiado. Only the fiado part of a sale
 * (`credit`, already net of what was paid at the counter) and deuda anterior
 * raise the debt; abonos (customerPayment rows) and returns that reduce debt
 * lower it. Paid-at-the-moment purchases and cash refunds never move it, so
 *   totalFiado − totalAbonado − totalDevuelto = DEBES
 * when the ledger is complete.
 */
export function customerPortalTotals(ledger: CustomerLedger) {
  return {
    totalFiado:
      ledger.initials.reduce((s, d) => s + d.amount, 0) +
      ledger.sales.reduce((s, sale) => s + Math.max(0, sale.credit), 0),
    totalAbonado: ledger.payments.reduce((s, p) => s + p.amount, 0),
    totalDevuelto: ledger.sales.reduce(
      (s, sale) => s + (sale.returns ?? []).reduce((r, ret) => r + Math.max(0, ret.debtReduced), 0),
      0,
    ),
    movimientos:
      ledger.sales.length + ledger.payments.length + ledger.initials.length,
  };
}

export function customerStatementRows(
  ledger: CustomerLedger,
): CustomerStatementRow[] {
  const rows: CustomerStatementRow[] = [];

  for (const d of ledger.initials) {
    rows.push({
      id: `inicial-${d.id}`,
      at: epoch(d.createdAt),
      occurredOn: d.occurredOn,
      kind: "inicial",
      title: "Deuda anterior",
      amount: d.amount,
    });
  }

  for (const s of ledger.sales) {
    rows.push({
      id: `sale-${s.id}`,
      at: epoch(s.createdAt),
      occurredOn: s.occurredOn,
      kind: s.credit > 0 ? "fiado" : "compra",
      title: s.credit > 0 ? (s.paymentKind === "partial" ? "Venta parcial" : "Fiado") : "Compra",
      amount: s.credit > 0 ? s.credit : s.saleTotal,
      href: `/cliente/compras/${s.id}`,
    });
    for (const r of s.returns ?? []) {
      // A return can lower the debt, hand money back, or both: one row per effect.
      if (r.debtReduced > 0) {
        rows.push({
          id: `dev-${r.id}`,
          at: epoch(r.createdAt),
          occurredOn: r.occurredOn,
          kind: "devolucion",
          title: "Devolución",
          amount: r.debtReduced,
          href: `/cliente/compras/${s.id}`,
        });
      }
      if (r.refundAmount > 0) {
        rows.push({
          id: `dev-${r.id}-reembolso`,
          at: epoch(r.createdAt),
          occurredOn: r.occurredOn,
          kind: "reembolso",
          title: "Devolución",
          amount: r.refundAmount,
          href: `/cliente/compras/${s.id}`,
        });
      }
    }
  }

  for (const p of ledger.payments) {
    rows.push({
      id: `pay-${p.id}`,
      at: epoch(p.createdAt),
      occurredOn: p.occurredOn,
      kind: "pago",
      title: p.method === "Nequi" ? "Pago Nequi" : "Pago Efectivo",
      amount: p.amount,
      href: "/cliente/pagos",
    });
  }

  rows.sort((a, b) => b.at - a.at);
  return rows;
}

export function findCustomerSale(
  ledger: CustomerLedger,
  saleId: string,
): CustomerLedgerSale | undefined {
  return ledger.sales.find((s) => s.id === saleId);
}
