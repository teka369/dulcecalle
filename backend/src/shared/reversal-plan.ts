/**
 * C07 — pure planning of compensating debt_allocations rows for a reversal
 * (SPEC-C07 §5.1 / §5.2). No I/O. Rows are never updated or deleted: a
 * reversal adds new rows (source_type `reversal`, mode `reversal`), each one
 * tagged with the ORIGIN source whose money it moves, so the per-source trace
 * (I-A1) survives without touching the original rows.
 */
import { fifoOrder, planAllocation, type Obligation, type ObligationKind } from "./allocation";

export type AllocRow = {
  id: string;
  sourceType: string;
  sourceId: string;
  originSourceType?: string | null;
  originSourceId?: string | null;
  targetType: string;
  saleId: string | null;
  initialDebtId: string | null;
  amount: bigint;
  mode: string;
  createdAt: number;
};

export type ReversalLine = {
  targetType: ObligationKind | "credit";
  /** Obligation id; null for credit. */
  id: string | null;
  /** Signed: < 0 releases, > 0 applies. */
  amount: bigint;
  /** Origin source of the money (null = the reversal itself, e.g. closing a voided sale). */
  originSourceType: string | null;
  originSourceId: string | null;
  kind: "release" | "reimpute" | "unapply" | "credit_out" | "close";
};

export class ReversalPlanError extends Error {
  constructor(public readonly reason: "credit_already_refunded" | "nothing_to_void", message: string) {
    super(message);
  }
}

export const REVERSAL_PLAN_MESSAGES = {
  creditRefunded:
    "El saldo a favor de este abono ya se devolvió en dinero. No se puede anular sin dejar el saldo a favor negativo.",
  nothingToVoid: "No queda nada por anular: la venta ya se devolvió completa.",
} as const;

/** The source whose money a row carries (reversal rows: their origin). */
export function originOf(r: Pick<AllocRow, "sourceType" | "sourceId" | "originSourceType" | "originSourceId">): string {
  if (r.sourceType === "reversal") {
    return r.originSourceType && r.originSourceId ? `${r.originSourceType}:${r.originSourceId}` : `reversal:${r.sourceId}`;
  }
  return `${r.sourceType}:${r.sourceId}`;
}

export function targetKeyOf(r: Pick<AllocRow, "targetType" | "saleId" | "initialDebtId">): string {
  if (r.targetType === "sale") return `sale:${r.saleId}`;
  if (r.targetType === "initial_debt") return `initial_debt:${r.initialDebtId}`;
  return "credit";
}

function splitKey(key: string): { type: string; id: string } {
  const i = key.indexOf(":");
  return { type: key.slice(0, i), id: key.slice(i + 1) };
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/** Net amount per (origin, target) over all rows. */
function netTable(rows: ReadonlyArray<AllocRow>): Map<string, Map<string, bigint>> {
  const t = new Map<string, Map<string, bigint>>();
  for (const r of rows) {
    const o = originOf(r);
    const m = t.get(o) ?? new Map<string, bigint>();
    const k = targetKeyOf(r);
    m.set(k, (m.get(k) ?? 0n) + r.amount);
    t.set(o, m);
  }
  return t;
}

function lineFor(targetKey: string, amount: bigint, origin: string | null, kind: ReversalLine["kind"]): ReversalLine {
  const o = origin ? splitKey(origin) : null;
  if (targetKey === "credit") {
    return { targetType: "credit", id: null, amount, originSourceType: o?.type ?? null, originSourceId: o?.id ?? null, kind };
  }
  const t = splitKey(targetKey);
  return {
    targetType: t.type as ObligationKind,
    id: t.id,
    amount,
    originSourceType: o?.type ?? null,
    originSourceId: o?.id ?? null,
    kind,
  };
}

export type ReversalPlan = {
  lines: ReversalLine[];
  /** Change of customers.debt (= −Σ obligation lines). */
  debtDelta: bigint;
  /** Change of customers.credit_balance (= Σ credit lines). */
  creditDelta: bigint;
};

function totals(lines: ReversalLine[]): ReversalPlan {
  let debtDelta = 0n;
  let creditDelta = 0n;
  for (const l of lines) {
    if (l.targetType === "credit") creditDelta += l.amount;
    else debtDelta -= l.amount;
  }
  return { lines, debtDelta, creditDelta };
}

/**
 * §5.2 — reverse a payment. Every obligation still funded by the payment's
 * money is reopened (mirror negative row). The part that sits in saldo a
 * favor leaves it; if saldo a favor is short because it was already applied
 * (credit_apply), those applications are undone first, newest first, which
 * reopens obligations (debt goes up). Never credit_balance < 0: if the money
 * was refunded in cash (credit_refund) and nothing is left to undo, the plan
 * fails with `credit_already_refunded`.
 */
export function planPaymentReversal(input: {
  paymentId: string;
  rows: ReadonlyArray<AllocRow>;
  obligations: ReadonlyArray<Obligation>;
  creditBalance: bigint;
}): ReversalPlan {
  const origin = `payment:${input.paymentId}`;
  const net = netTable(input.rows);
  const mine = net.get(origin) ?? new Map<string, bigint>();
  const applied = new Map<string, bigint>();
  for (const o of input.obligations) applied.set(`${o.kind}:${o.id}`, o.original - o.open);
  const lines: ReversalLine[] = [];

  const order = fifoOrder(input.obligations).map((o) => `${o.kind}:${o.id}`);
  const keys = [...mine.keys()].filter((k) => k !== "credit");
  keys.sort((a, b) => (order.indexOf(a) - order.indexOf(b)) || (a < b ? -1 : a > b ? 1 : 0));
  for (const k of keys) {
    const x = mine.get(k) ?? 0n;
    if (x <= 0n) continue;
    lines.push(lineFor(k, -x, origin, "release"));
    applied.set(k, (applied.get(k) ?? 0n) - x);
  }

  const netCredit = mine.get("credit") ?? 0n;
  if (netCredit > 0n) {
    let shortfall = netCredit - input.creditBalance;
    if (shortfall > 0n) {
      const candidates = input.rows
        .filter((r) => r.mode === "credit_apply" && r.targetType !== "credit" && r.amount > 0n && r.sourceType !== "reversal")
        .sort((a, b) => (b.createdAt - a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
      for (const c of candidates) {
        if (shortfall <= 0n) break;
        const o = originOf(c);
        if (o === origin) continue;
        const tk = targetKeyOf(c);
        const om = net.get(o) ?? new Map<string, bigint>();
        const haveOrigin = om.get(tk) ?? 0n;
        const haveTarget = applied.get(tk) ?? 0n;
        const y = minBig(minBig(c.amount, shortfall), minBig(haveOrigin, haveTarget));
        if (y <= 0n) continue;
        lines.push(lineFor(tk, -y, o, "unapply"));
        lines.push(lineFor("credit", y, o, "unapply"));
        om.set(tk, haveOrigin - y);
        om.set("credit", (om.get("credit") ?? 0n) + y);
        net.set(o, om);
        applied.set(tk, haveTarget - y);
        shortfall -= y;
      }
      if (shortfall > 0n) {
        throw new ReversalPlanError("credit_already_refunded", REVERSAL_PLAN_MESSAGES.creditRefunded);
      }
    }
    lines.push(lineFor("credit", -netCredit, origin, "credit_out"));
  }
  return totals(lines);
}

export type SaleVoidPlan = ReversalPlan & {
  /** Open balance of the sale before the void. */
  openOwn: bigint;
  /** Money released from the sale (payments, credit applied, other returns). */
  released: bigint;
  /** Money to give back from caja by the sale's method (≥ 0). */
  cashOut: bigint;
};

/**
 * §5.1 — void what is left of a sale (sale − returns, I-R11). `remainingValue`
 * = Σ (qty − returned) × unitPrice. The sale's open balance is closed; money
 * that was paying it (payments, saldo a favor applied, other returns' FIFO)
 * is released — capped at what the customer did not get back already — and
 * re-imputed FIFO to the customer's other obligations, the rest to saldo a
 * favor. The own returns' `debtReduced` rows stay as they are. What is left
 * of the value was paid at the counter and leaves the caja (`cashOut`).
 */
export function planSaleVoid(input: {
  saleId: string;
  hasCustomer: boolean;
  remainingValue: bigint;
  /** amountReceived − Σ refundAmount of prior returns. */
  cashNet: bigint;
  rows: ReadonlyArray<AllocRow>;
  obligations: ReadonlyArray<Obligation>;
  ownReturnIds: ReadonlySet<string>;
}): SaleVoidPlan {
  if (input.remainingValue <= 0n) {
    throw new ReversalPlanError("nothing_to_void", REVERSAL_PLAN_MESSAGES.nothingToVoid);
  }
  const saleKey = `sale:${input.saleId}`;
  const own = input.obligations.find((o) => o.kind === "sale" && o.id === input.saleId);
  const openOwn = own ? (own.open > 0n ? own.open : 0n) : 0n;
  const lines: ReversalLine[] = [];
  let released = 0n;

  if (input.hasCustomer) {
    // Releasable money on this sale, per origin (own returns' debtReduced excluded).
    const perOrigin = new Map<string, { net: bigint; last: number; lastId: string }>();
    for (const r of input.rows) {
      if (r.targetType !== "sale" || r.saleId !== input.saleId) continue;
      if (r.sourceType === "sale_return" && input.ownReturnIds.has(r.sourceId) && r.mode !== "credit_apply") continue;
      const o = originOf(r);
      const cur = perOrigin.get(o) ?? { net: 0n, last: 0, lastId: "" };
      cur.net += r.amount;
      if (r.createdAt > cur.last || (r.createdAt === cur.last && r.id > cur.lastId)) {
        cur.last = r.createdAt;
        cur.lastId = r.id;
      }
      perOrigin.set(o, cur);
    }
    let cap = input.remainingValue - openOwn;
    if (cap < 0n) cap = 0n;
    const newestFirst = [...perOrigin.entries()]
      .filter(([, v]) => v.net > 0n)
      .sort((a, b) => (b[1].last - a[1].last) || (a[1].lastId < b[1].lastId ? 1 : -1));
    const releasedBy: Array<{ origin: string; amount: bigint }> = [];
    for (const [o, v] of newestFirst) {
      if (cap <= 0n) break;
      const x = minBig(v.net, cap);
      lines.push(lineFor(saleKey, -x, o, "release"));
      releasedBy.push({ origin: o, amount: x });
      released += x;
      cap -= x;
    }
    if (released > 0n) {
      // Re-impute FIFO over the other obligations; the rest is saldo a favor.
      const others = input.obligations.filter((o) => !(o.kind === "sale" && o.id === input.saleId));
      const plan = planAllocation({ amount: released, obligations: others, target: { mode: "fifo" }, overflow: "fifo" });
      // Oldest released money first (stable, deterministic).
      const queue = [...releasedBy].reverse().map((r) => ({ ...r }));
      let qi = 0;
      for (const pl of plan.lines) {
        let left = pl.amount;
        const tk = pl.targetType === "credit" ? "credit" : `${pl.targetType}:${pl.id}`;
        while (left > 0n) {
          const src = queue[qi]!;
          const x = minBig(left, src.amount);
          lines.push(lineFor(tk, x, src.origin, "reimpute"));
          src.amount -= x;
          left -= x;
          if (src.amount === 0n) qi++;
        }
      }
    }
    const toClose = openOwn + released;
    if (toClose > 0n) lines.push(lineFor(saleKey, toClose, null, "close"));
  }

  let cashOut = input.remainingValue - openOwn - released;
  if (cashOut > input.cashNet) cashOut = input.cashNet;
  if (cashOut < 0n) cashOut = 0n;
  return { ...totals(lines), openOwn, released, cashOut };
}
