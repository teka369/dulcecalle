import { addCop, subCop } from "@/domain/money";
import type { DebtStatement } from "@/domain/debt/statement";
import { asIsoEpoch, mapCustomer, mapSale, mapPayment } from "../http/mappers";
import { getPwaApi } from "./api";

export async function loadHttpStatement(
  customerId: string,
): Promise<DebtStatement | null> {
  const api = getPwaApi();
  const ledger = await api.customers.ledger(customerId);
  const customer = mapCustomer(ledger.customer);
  const initials = ledger.initials.map((row) => ({
    id: String(row.id),
    amount: Number(row.amount),
    note: row.note == null ? undefined : String(row.note),
    createdAt: asIsoEpoch(row.createdAt),
  }));
  const sales = ledger.sales.map((row) => mapSale(row));
  const payments = ledger.payments.map((row) => mapPayment(row));

  type Event = {
    at: number;
    apply: (
      balance: number,
    ) => { next: number; entry: DebtStatement["entries"][number] };
  };
  const events: Event[] = [];

  for (const d of initials) {
    events.push({
      at: d.createdAt,
      apply: (balance) => ({
        next: addCop(balance, d.amount),
        entry: {
          kind: "inicial",
          id: `inicial-${d.id}`,
          createdAt: d.createdAt,
          amount: d.amount,
          note: d.note,
          runningBalance: 0,
        },
      }),
    });
  }

  let fiadoIndex = 0;
  const creditSales = sales
    .filter((s) => s.credit > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const s of creditSales) {
    fiadoIndex += 1;
    const index = fiadoIndex;
    events.push({
      at: s.createdAt,
      apply: (balance) => ({
        next: addCop(balance, s.credit),
        entry: {
          kind: s.paymentKind === "partial" ? "parcial" : "fiada",
          id: `sale-${s.id}`,
          saleId: s.id,
          createdAt: s.createdAt,
          saleTotal: s.saleTotal,
          amountReceived: s.amountReceived,
          credit: s.credit,
          lines: s.lines.map((l) => ({
            productName: l.productName,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
          fiadoIndex: index,
          runningBalance: 0,
        },
      }),
    });
  }

  for (const p of payments) {
    events.push({
      at: p.createdAt,
      apply: (balance) => ({
        next: subCop(balance, p.amount),
        entry: {
          kind: "abono",
          id: `pay-${p.id}`,
          createdAt: p.createdAt,
          amount: p.amount,
          method: p.method,
          runningBalance: 0,
        },
      }),
    });
  }

  for (const s of ledger.sales) {
    const returns = Array.isArray(s.returns) ? s.returns : [];
    for (const raw of returns) {
      const amount = Number(raw.debtReduced);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const createdAt = asIsoEpoch(raw.createdAt);
      events.push({
        at: createdAt,
        apply: (balance) => ({
          next: subCop(balance, amount),
          entry: {
            kind: "devolucion",
            id: `dev-${String(raw.id)}`,
            createdAt,
            amount,
            runningBalance: 0,
          },
        }),
      });
    }
  }

  events.sort((a, b) => a.at - b.at);
  const entries: DebtStatement["entries"] = [];
  let running = 0;
  for (const event of events) {
    const { next, entry } = event.apply(running);
    running = next;
    entries.push({ ...entry, runningBalance: running });
  }

  const charged = entries.reduce((sum, e) => {
    if (e.kind === "inicial") return addCop(sum, e.amount);
    if (e.kind === "fiada" || e.kind === "parcial") return addCop(sum, e.credit);
    return sum;
  }, 0);
  const paid = entries.reduce((sum, e) => {
    if (e.kind === "abono" || e.kind === "devolucion") return addCop(sum, e.amount);
    return sum;
  }, 0);

  return {
    customerId: customer.id,
    customerName: customer.name,
    total: customer.debt,
    charged,
    paid,
    entries,
  };
}
