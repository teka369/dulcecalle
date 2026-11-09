/**
 * C04 — open purchases / initial debts of a customer, saldo a favor and
 * abonos the server applied differently (W1, W3, W4, W7, W8).
 *
 * Online: the server ledger is the truth (`openBalance`, `creditBalance`).
 * Offline: an estimate from this device (cached debt walked FIFO over the
 * cached purchases). Callers label it «estimado» (T20) and never offer
 * saldo a favor offline (J3 / T34).
 */
import { NetworkError, isNetworkError } from "../errors";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { fifoOrder, type Obligation } from "@/domain/allocation";
import { mapCustomer, mapPayment, mapReversalRef, type RemoteAllocation, type RemoteReversalRef } from "../http/mappers";

export type OpenObligation = Obligation & {
  /** C07 — the sale was voided («Anulada»). */
  reversed?: boolean;
  /** «Compra 2 nov» / «Deuda anterior 2 oct». */
  label: string;
  /** Sale still only on this device: target it by its requestId. */
  localRequestId?: string;
  /** Outbox op the abono has to wait for. */
  localOperationId?: string;
};

export type AdjustedPayment = {
  id: string;
  amount: number;
  createdAt: number;
  requestedSaleId: string | null;
  allocations: RemoteAllocation[];
  reviewedAt: string | null;
};

/** C07 — an abono as the server ledger shows it (W3, W4). */
export type LedgerPayment = {
  id: string;
  amount: number;
  method: string;
  occurredOn: string;
  createdAt: number;
  note: string | null;
  reversal: RemoteReversalRef | null;
  replacesPaymentId: string | null;
  replacedByPaymentId: string | null;
};

export type CustomerMoneyState = {
  source: "server" | "estimate";
  debt: number;
  creditBalance: number;
  /** All obligations (open and settled), FIFO order. */
  obligations: OpenObligation[];
  adjusted: AdjustedPayment[];
  /** null when unknown (offline / old server). */
  isOwner: boolean | null;
  /** C07 — server abonos, newest first (empty offline). */
  payments?: LedgerPayment[];
};

const DAY = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", timeZone: "UTC" });

export function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return DAY.format(new Date(Date.UTC(y, m - 1, d))).replace(".", "");
}

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

export async function ownerRole(): Promise<boolean | null> {
  try {
    const businessId = getPwaAuthSession().businessId;
    const me = await getPwaApi().auth.me();
    const m = me.memberships.find((x) => x.businessId === businessId);
    return m ? m.role === "owner" : null;
  } catch {
    return null;
  }
}

export async function loadCustomerMoneyState(customerId: string): Promise<CustomerMoneyState> {
  try {
    return await loadFromServer(customerId);
  } catch (e) {
    if (!(e instanceof NetworkError) && !isNetworkError(e)) throw e;
    const est = await loadEstimate(customerId);
    if (!est) throw e;
    return est;
  }
}

async function loadFromServer(customerId: string): Promise<CustomerMoneyState> {
  const [ledger, isOwner] = await Promise.all([getPwaApi().customers.ledger(customerId), ownerRole()]);
  const customer = mapCustomer(ledger.customer);
  const obligations: OpenObligation[] = [];
  for (const raw of ledger.initials) {
    const amount = num(raw.amount);
    const occurredOn = String(raw.occurredOn ?? "").slice(0, 10);
    obligations.push({
      kind: "initial_debt",
      id: String(raw.id),
      occurredOn,
      createdAt: Date.parse(String(raw.createdAt)) || 0,
      original: amount,
      open: raw.openBalance == null ? amount : num(raw.openBalance),
      label: `Deuda anterior ${dayLabel(occurredOn)}`,
    });
  }
  for (const raw of ledger.sales) {
    const credit = num(raw.credit);
    if (credit <= 0) continue;
    const occurredOn = String(raw.occurredOn ?? "").slice(0, 10);
    obligations.push({
      kind: "sale",
      id: String(raw.id),
      occurredOn,
      createdAt: Date.parse(String(raw.createdAt)) || 0,
      original: credit,
      open: raw.openBalance == null ? credit : num(raw.openBalance),
      label: `Compra ${dayLabel(occurredOn)}`,
      ...(raw.reversal ? { reversed: true } : {}),
    });
  }
  const payments: LedgerPayment[] = ledger.payments
    .map((raw) => ({
      id: String(raw.id),
      amount: num(raw.amount),
      method: String(raw.method ?? ""),
      occurredOn: String(raw.occurredOn ?? "").slice(0, 10),
      createdAt: Date.parse(String(raw.createdAt)) || 0,
      note: raw.note == null ? null : String(raw.note),
      reversal: mapReversalRef(raw.reversal),
      replacesPaymentId: typeof raw.replacesPaymentId === "string" ? raw.replacesPaymentId : null,
      replacedByPaymentId: typeof raw.replacedByPaymentId === "string" ? raw.replacedByPaymentId : null,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
  const adjusted: AdjustedPayment[] = [];
  for (const raw of ledger.payments) {
    if (raw.adjusted !== true) continue;
    const p = mapPayment(raw);
    const req = (raw.requestedTarget ?? null) as { mode?: string; saleId?: string } | null;
    adjusted.push({
      id: p.id,
      amount: p.amount,
      createdAt: p.createdAt,
      requestedSaleId: req?.mode === "sale" && typeof req.saleId === "string" ? req.saleId : null,
      allocations: p.allocations ?? [],
      reviewedAt: p.adjustedReviewedAt ?? null,
    });
  }
  return {
    source: "server",
    debt: customer.debt,
    creditBalance: customer.creditBalance ?? 0,
    obligations: fifoOrder(obligations),
    adjusted,
    isOwner,
    payments,
  };
}

/** Offline estimate: cached debt walked over cached obligations, newest last. */
export async function loadEstimate(customerId: string): Promise<CustomerMoneyState | null> {
  const businessId = getPwaAuthSession().businessId;
  if (!businessId) return null;
  const db = getLocalDb();
  const customer = await db.customers.where("[businessId+id]").equals([businessId, customerId]).first();
  if (!customer) return null;
  const ops = await db.outbox.where("businessId").equals(businessId).toArray();
  const pendingByRequest = new Map(ops.filter((o) => o.status !== "synced").map((o) => [o.requestId, o]));
  const obligations: OpenObligation[] = [];
  const initials = await db.initialDebts.where("businessId").equals(businessId).toArray();
  for (const d of initials) {
    if (d.customerId !== customerId) continue;
    obligations.push({
      kind: "initial_debt",
      id: d.id,
      occurredOn: d.occurredOn,
      createdAt: d.createdAt,
      original: d.amount,
      open: d.amount,
      label: `Deuda anterior ${dayLabel(d.occurredOn)}`,
    });
  }
  const sales = await db.sales.where("businessId").equals(businessId).toArray();
  for (const s of sales) {
    if (s.customerId !== customerId || s.credit <= 0) continue;
    const op = pendingByRequest.get(s.requestId);
    obligations.push({
      kind: "sale",
      id: s.id,
      occurredOn: s.occurredOn,
      createdAt: s.createdAt,
      original: s.credit,
      open: s.credit,
      label: `Compra ${dayLabel(s.occurredOn)}`,
      ...(op && op.entity === "sale" ? { localRequestId: s.requestId, localOperationId: op.operationId } : {}),
    });
  }
  const ordered = fifoOrder(obligations);
  return {
    source: "estimate",
    debt: customer.debt,
    creditBalance: customer.creditBalance ?? 0,
    obligations: estimateOpen(ordered, customer.debt),
    adjusted: [],
    isOwner: null,
  };
}

/**
 * What is still owed sits on the newest obligations (everything older was
 * paid first, FIFO). Pure; exported for tests.
 */
export function estimateOpen<T extends Obligation>(ordered: T[], debt: number): T[] {
  let left = Math.max(0, debt);
  const out = ordered.map((o) => ({ ...o, open: 0 }));
  for (let i = out.length - 1; i >= 0 && left > 0; i--) {
    const take = Math.min(out[i].original, left);
    out[i].open = take;
    left -= take;
  }
  return out;
}
