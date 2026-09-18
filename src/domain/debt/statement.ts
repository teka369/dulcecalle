import type {
  Customer,
  CustomerPayment,
  InitialDebt,
  Sale,
  SaleLine,
  SaleReturn,
} from "@/domain/types";

export type DebtLineView = {
  productName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type DebtEntry =
  | {
      kind: "inicial";
      id: string;
      createdAt: number;
      amount: number;
      note?: string;
      runningBalance: number;
    }
  | {
      kind: "fiada" | "parcial";
      id: string;
      saleId: number;
      createdAt: number;
      saleTotal: number;
      amountReceived: number;
      credit: number;
      lines: DebtLineView[];
      fiadoIndex: number;
      runningBalance: number;
    }
  | {
      kind: "abono";
      id: string;
      createdAt: number;
      amount: number;
      method: string;
      runningBalance: number;
    }
  | {
      kind: "devolucion";
      id: string;
      createdAt: number;
      amount: number;
      runningBalance: number;
    };

export type DebtStatement = {
  customerId: number;
  customerName: string;
  total: number;
  charged: number;
  paid: number;
  entries: DebtEntry[];
};

type RawEvent = {
  at: number;
  apply: (balance: number) => { next: number; entry: Omit<DebtEntry, "runningBalance"> };
};

/**
 * Ledger of what a customer owes, from existing rows only.
 * Does not invent products for initialDebts. Does not rewrite history.
 */
export function buildDebtStatement(input: {
  customer: Customer;
  initials: InitialDebt[];
  sales: Sale[];
  lines: SaleLine[];
  payments: CustomerPayment[];
  returns: SaleReturn[];
}): DebtStatement {
  const linesBySale = new Map<number, SaleLine[]>();
  for (const line of input.lines) {
    const list = linesBySale.get(line.saleId) ?? [];
    list.push(line);
    linesBySale.set(line.saleId, list);
  }

  const events: RawEvent[] = [];

  for (const d of input.initials) {
    events.push({
      at: d.createdAt,
      apply: (balance) => ({
        next: balance + d.amount,
        entry: {
          kind: "inicial",
          id: `inicial-${d.id ?? d.createdAt}`,
          createdAt: d.createdAt,
          amount: d.amount,
          note: d.note,
        },
      }),
    });
  }

  let fiadoIndex = 0;
  const creditSales = input.sales
    .filter((s) => s.credit > 0 && s.id != null)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const s of creditSales) {
    fiadoIndex += 1;
    const index = fiadoIndex;
    const saleId = s.id as number;
    const kind = s.paymentKind === "partial" ? "parcial" : "fiada";
    const lines = (linesBySale.get(saleId) ?? []).map((l) => ({
      productName: l.productName,
      qty: l.qty,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
    }));
    events.push({
      at: s.createdAt,
      apply: (balance) => ({
        next: balance + s.credit,
        entry: {
          kind,
          id: `sale-${saleId}`,
          saleId,
          createdAt: s.createdAt,
          saleTotal: s.saleTotal,
          amountReceived: s.amountReceived,
          credit: s.credit,
          lines,
          fiadoIndex: index,
        },
      }),
    });
  }

  for (const p of input.payments) {
    events.push({
      at: p.createdAt,
      apply: (balance) => ({
        next: balance - p.amount,
        entry: {
          kind: "abono",
          id: `pay-${p.id ?? p.createdAt}`,
          createdAt: p.createdAt,
          amount: p.amount,
          method: p.method,
        },
      }),
    });
  }

  const saleIds = new Set(
    input.sales.map((s) => s.id).filter((id): id is number => id != null),
  );
  for (const r of input.returns) {
    if (!saleIds.has(r.saleId) || r.debtReduced <= 0) continue;
    events.push({
      at: r.createdAt,
      apply: (balance) => ({
        next: balance - r.debtReduced,
        entry: {
          kind: "devolucion",
          id: `dev-${r.id ?? r.createdAt}`,
          createdAt: r.createdAt,
          amount: r.debtReduced,
        },
      }),
    });
  }

  events.sort((a, b) => a.at - b.at);

  const entries: DebtEntry[] = [];
  let running = 0;
  for (const event of events) {
    const { next, entry } = event.apply(running);
    running = next;
    entries.push({ ...entry, runningBalance: running } as DebtEntry);
  }

  const charged = entries.reduce((sum, e) => {
    if (e.kind === "inicial") return sum + e.amount;
    if (e.kind === "fiada" || e.kind === "parcial") return sum + e.credit;
    return sum;
  }, 0);
  const paid = entries.reduce((sum, e) => {
    if (e.kind === "abono" || e.kind === "devolucion") return sum + e.amount;
    return sum;
  }, 0);

  return {
    customerId: input.customer.id ?? 0,
    customerName: input.customer.name,
    total: input.customer.debt,
    charged,
    paid,
    entries,
  };
}

export function formatBogotaDateTime(ms: number): string {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

export function entryTitle(entry: DebtEntry): string {
  if (entry.kind === "inicial") return "Deuda inicial";
  if (entry.kind === "abono") return "Pago";
  if (entry.kind === "devolucion") return "Devolución";
  const n = String(entry.fiadoIndex).padStart(3, "0");
  return entry.kind === "parcial" ? `Fiado #${n} · parcial` : `Fiado #${n}`;
}
