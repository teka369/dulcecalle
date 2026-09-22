import { NetworkError } from "../errors";
import type { DebtStatement } from "@/domain/debt/statement";
import { addCop, subCop } from "@/domain/money";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { loadHttpStatement } from "./statement";

/**
 * Admin customer statement with an honest offline fallback. Online uses
 * the server ledger; only a NetworkError falls back to Dexie rows created
 * on this device (offline sales, payments, initial debts). There is no
 * local source for returns (returns are online-only), so they are simply
 * absent offline. `total` always comes from the cached server debt.
 */
export async function getStatementWithOfflineFallback(
  customerId: string,
): Promise<{ statement: DebtStatement; source: "server" | "cache" } | null> {
  try {
    const statement = await loadHttpStatement(customerId);
    if (!statement) return null;
    return { statement, source: "server" };
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const businessId = getPwaAuthSession().businessId;
    if (!businessId) throw e;
    const statement = await buildLocalStatement(businessId, customerId);
    if (!statement) throw e;
    return { statement, source: "cache" };
  }
}

async function buildLocalStatement(
  businessId: string,
  customerId: string,
): Promise<DebtStatement | null> {
  const db = getLocalDb();
  const customer = await db.customers
    .where("[businessId+id]")
    .equals([businessId, customerId])
    .first();
  if (!customer) return null;

  type Entry = DebtStatement["entries"][number];
  const events: Array<{ at: number; entry: Entry; delta: number }> = [];

  const initials = await db.initialDebts
    .where("[businessId+customerId]")
    .equals([businessId, customerId])
    .toArray();
  for (const d of initials) {
    events.push({
      at: d.createdAt,
      delta: d.amount,
      entry: {
        kind: "inicial",
        id: `inicial-${d.id}`,
        createdAt: d.createdAt,
        amount: d.amount,
        note: d.note ?? undefined,
        runningBalance: 0,
      },
    });
  }

  const sales = await db.sales.where("businessId").equals(businessId).toArray();
  let fiadoIndex = 0;
  for (const s of sales.filter((row) => row.customerId === customerId && row.credit > 0)) {
    fiadoIndex += 1;
    const lines = await db.saleLines
      .where("[businessId+saleId]")
      .equals([businessId, s.id])
      .toArray();
    events.push({
      at: s.createdAt,
      delta: s.credit,
      entry: {
        kind: s.paymentKind === "partial" ? "parcial" : "fiada",
        id: `sale-${s.id}`,
        saleId: s.id,
        createdAt: s.createdAt,
        saleTotal: s.saleTotal,
        amountReceived: s.amountReceived,
        credit: s.credit,
        lines: lines.map((l) => ({
          productName: l.productName,
          qty: l.qty,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
        fiadoIndex,
        runningBalance: 0,
      },
    });
  }

  const payments = await db.customerPayments
    .where("[businessId+customerId]")
    .equals([businessId, customerId])
    .toArray();
  for (const p of payments) {
    events.push({
      at: p.createdAt,
      delta: -p.amount,
      entry: {
        kind: "abono",
        id: `pay-${p.id}`,
        createdAt: p.createdAt,
        amount: p.amount,
        method: p.method,
        ...(p.note ? { note: p.note } : {}),
        runningBalance: 0,
      },
    });
  }

  events.sort((a, b) => a.at - b.at);
  let running = 0;
  let charged = 0;
  let paid = 0;
  for (const event of events) {
    running = addCop(running, event.delta);
    if (event.delta >= 0) charged = addCop(charged, event.delta);
    else paid = addCop(paid, subCop(0, event.delta));
    event.entry.runningBalance = running;
  }

  return {
    customerId: customer.id,
    customerName: customer.name,
    total: customer.debt,
    charged,
    paid,
    entries: events.map((e) => e.entry),
  };
}
