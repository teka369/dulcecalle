import { NetworkError } from "../errors";
import type { DebtStatement } from "@/domain/debt/statement";
import { addCop, subCop } from "@/domain/money";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { loadHttpStatement } from "./statement";
import { isActiveDebtIntent } from "./pending-debt";

/**
 * Admin customer statement with an honest offline fallback. Online uses
 * the server ledger. A NetworkError falls back to Dexie rows on this device
 * plus a pending return projection. Pending returns reduce debt only by
 * debtReduced, stay marked pending, and do not change stock or cash.
 * `total` is the local customer balance, including those pending effects.
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
  const ops = await db.outbox.where("businessId").equals(businessId).toArray();
  const deadRequests = new Set(
    ops
      .filter((op) => op.status === "failed" && op.nextAttemptAt == null)
      .map((op) => op.requestId),
  );
  for (const d of initials) {
    if (deadRequests.has(d.requestId)) continue;
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

  const customerSaleIds = new Set(
    sales.filter((row) => row.customerId === customerId).map((row) => row.id),
  );
  const returns = await db.saleReturns.where("businessId").equals(businessId).toArray();
  const confirmedReturnRequests = new Set(returns.map((row) => row.requestId));
  for (const ret of returns) {
    if (ret.debtReduced <= 0 || !customerSaleIds.has(ret.saleId)) continue;
    events.push({
      at: ret.createdAt,
      delta: -ret.debtReduced,
      entry: {
        kind: "devolucion",
        id: `dev-${ret.id}`,
        createdAt: ret.createdAt,
        amount: ret.debtReduced,
        runningBalance: 0,
      },
    });
  }
  for (const op of ops) {
    if (!isActiveDebtIntent(op) || op.entity !== "saleReturn" || op.operation !== "return") {
      continue;
    }
    if (confirmedReturnRequests.has(op.requestId)) continue;
    const raw = op.payload;
    if (!raw || typeof raw !== "object") continue;
    const saleRef = (raw as { saleRef?: unknown }).saleRef;
    const reduced = (raw as { projectedDebtReduced?: unknown }).projectedDebtReduced;
    if (typeof saleRef !== "string" || typeof reduced !== "number" || reduced <= 0) continue;
    if (!customerSaleIds.has(saleRef)) continue;
    events.push({
      at: op.localCreatedAt,
      delta: -reduced,
      entry: {
        kind: "devolucion",
        id: `dev-pending-${op.operationId}`,
        createdAt: op.localCreatedAt,
        amount: reduced,
        pending: true,
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
