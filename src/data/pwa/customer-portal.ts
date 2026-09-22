import type {
  CustomerLedger,
  CustomerLedgerSale,
} from "../http/customer-api";

export type CustomerStatementRow = {
  id: string;
  at: number;
  occurredOn: string;
  kind: "compra" | "pago" | "fiado" | "inicial" | "devolucion";
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
 * A partial sale does NOT create a CustomerLedgerPayment (verified in
 * sales.service.ts: only the pay endpoint writes customerPayment rows),
 * so its amountReceived lives only on the sale. Counting it here cannot
 * double-count: payments[] and partial amountReceived are disjoint by
 * construction. Paid sales are purchases, not abonos, and stay out.
 */
export function customerPortalTotals(ledger: CustomerLedger) {
  return {
    totalComprado: ledger.sales.reduce((s, sale) => s + sale.saleTotal, 0),
    totalAbonado:
      ledger.payments.reduce((s, p) => s + p.amount, 0) +
      ledger.sales
        .filter((sale) => sale.paymentKind === "partial")
        .reduce((s, sale) => s + sale.amountReceived, 0),
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
    for (const r of s.returns) {
      rows.push({
        id: `dev-${r.id}`,
        at: epoch(r.createdAt),
        occurredOn: r.occurredOn,
        kind: "devolucion",
        title: "Devolución",
        amount: r.debtReduced > 0 ? r.debtReduced : r.refundAmount,
        href: `/cliente/compras/${s.id}`,
      });
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
