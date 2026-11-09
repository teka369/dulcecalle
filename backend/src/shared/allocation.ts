/**
 * C04 — debt allocation (imputación de abonos). Pure, deterministic.
 *
 * Mirror of the PWA `src/domain/allocation.ts` (number there, bigint here),
 * same pattern as `splitReturnSettlement` in returns.ts. Keep both logically
 * identical: FIFO order, R1 (fifo), R2 (one sale), R3 (split), R4 (surplus to
 * saldo a favor), overflow, and the settled-sale adjustment of §6.3.
 */

export type ObligationKind = "sale" | "initial_debt";

export type Obligation = {
  kind: ObligationKind;
  id: string;
  /** Business-local day key (YYYY-MM-DD). InitialDebt enters by its own day (decision 8). */
  occurredOn: string;
  /** Server createdAt in epoch ms. */
  createdAt: number;
  /** sale.credit or initial_debt.amount. */
  original: bigint;
  /** original − Σ current allocations to it. */
  open: bigint;
};

export type SplitTarget = { kind: ObligationKind; id: string; amount: bigint };

export type AllocationTargetInput =
  | { mode: "fifo" }
  | { mode: "sale"; saleId: string }
  | { mode: "split"; targets: SplitTarget[] };

export type Overflow = "fifo" | "credit";

export type AllocationLine = {
  targetType: ObligationKind | "credit";
  /** Obligation id; null for credit. */
  id: string | null;
  amount: bigint;
  openBefore: bigint;
  openAfter: bigint;
  /** fifo = chosen by the FIFO walk; explicit = asked by the seller. */
  mode: "fifo" | "explicit";
};

export type AllocationPlan = {
  lines: AllocationLine[];
  toObligations: bigint;
  toCredit: bigint;
  /** §6.3: the requested sale was already settled; the money went elsewhere. */
  adjusted: boolean;
};

export type AllocationInvalidReason =
  | "split_exceeds_amount"
  | "target_not_open"
  | "target_exceeds_open"
  | "target_unknown"
  | "bad_amount";

export class AllocationInvalidError extends Error {
  constructor(public readonly reason: AllocationInvalidReason, message: string) {
    super(message);
  }
}

export const ALLOCATION_MESSAGES = {
  splitExceeds: "Lo repartido no puede ser más que el abono.",
  targetNotOpen: "Esa compra ya está saldada.",
  targetExceedsOpen: "No puede ser más que lo pendiente.",
  targetUnknown: "Esa compra no es de este cliente.",
  badAmount: "El monto tiene que ser mayor a 0.",
} as const;

function cmp(a: Obligation, b: Obligation): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/** FIFO (antigüedad): occurredOn ASC, createdAt ASC, id ASC. Deterministic. */
export function fifoOrder<T extends Obligation>(obligations: ReadonlyArray<T>): T[] {
  return [...obligations].sort(cmp);
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * Plan how `amount` is applied.
 * - fifo (R1): oldest open obligation first.
 * - sale (R2): that sale first up to its open balance; the rest by `overflow`.
 *   If the sale is known but already settled → `adjusted` and the whole amount
 *   follows `overflow` (§6.3). An unknown sale is `target_unknown`.
 * - split (R3): Σ ≤ amount, each target open and ≤ its open; rest by `overflow`.
 * - Anything left with no open obligation (or beyond `cap`) is saldo a favor (R4).
 *
 * `cap` bounds what may reach obligations (the stored customer debt), so the
 * stored debt can never go below 0 even on legacy rows without allocations.
 */
export function planAllocation(input: {
  amount: bigint;
  obligations: ReadonlyArray<Obligation>;
  target?: AllocationTargetInput;
  overflow?: Overflow;
  cap?: bigint;
}): AllocationPlan {
  const amount = input.amount;
  if (amount <= 0n) {
    throw new AllocationInvalidError("bad_amount", ALLOCATION_MESSAGES.badAmount);
  }
  const target = input.target ?? { mode: "fifo" };
  const overflow: Overflow = input.overflow ?? "fifo";
  const ordered = fifoOrder(input.obligations);
  const open = new Map<string, bigint>();
  for (const o of ordered) open.set(`${o.kind}:${o.id}`, o.open < 0n ? 0n : o.open);
  let capLeft = input.cap == null ? null : input.cap < 0n ? 0n : input.cap;
  const lines: AllocationLine[] = [];
  let rest = amount;
  let adjusted = false;

  const take = (o: { kind: ObligationKind; id: string }, want: bigint, mode: "fifo" | "explicit") => {
    const key = `${o.kind}:${o.id}`;
    const before = open.get(key) ?? 0n;
    let x = minBig(want, before);
    if (capLeft != null) x = minBig(x, capLeft);
    if (x <= 0n) return 0n;
    open.set(key, before - x);
    if (capLeft != null) capLeft -= x;
    lines.push({ targetType: o.kind, id: o.id, amount: x, openBefore: before, openAfter: before - x, mode });
    return x;
  };

  const known = (kind: ObligationKind, id: string) => open.has(`${kind}:${id}`);
  let restMode: "fifo" | "explicit" = "fifo";

  if (target.mode === "sale") {
    restMode = "explicit";
    if (!known("sale", target.saleId)) {
      throw new AllocationInvalidError("target_unknown", ALLOCATION_MESSAGES.targetUnknown);
    }
    const before = open.get(`sale:${target.saleId}`) ?? 0n;
    if (before <= 0n) {
      adjusted = true;
    } else {
      rest -= take({ kind: "sale", id: target.saleId }, rest, "explicit");
    }
  } else if (target.mode === "split") {
    restMode = "explicit";
    let sum = 0n;
    for (const t of target.targets) {
      if (t.amount <= 0n) {
        throw new AllocationInvalidError("bad_amount", ALLOCATION_MESSAGES.badAmount);
      }
      sum += t.amount;
    }
    if (sum > amount) {
      throw new AllocationInvalidError("split_exceeds_amount", ALLOCATION_MESSAGES.splitExceeds);
    }
    // Validate every target first, against the balances before this abono.
    const asked = new Map<string, bigint>();
    for (const t of target.targets) {
      if (!known(t.kind, t.id)) {
        throw new AllocationInvalidError("target_unknown", ALLOCATION_MESSAGES.targetUnknown);
      }
      const key = `${t.kind}:${t.id}`;
      asked.set(key, (asked.get(key) ?? 0n) + t.amount);
    }
    for (const [key, want] of asked) {
      const have = open.get(key) ?? 0n;
      if (have <= 0n) {
        throw new AllocationInvalidError("target_not_open", ALLOCATION_MESSAGES.targetNotOpen);
      }
      if (want > have) {
        throw new AllocationInvalidError("target_exceeds_open", ALLOCATION_MESSAGES.targetExceedsOpen);
      }
    }
    if (capLeft != null && sum > capLeft) {
      throw new AllocationInvalidError("target_exceeds_open", ALLOCATION_MESSAGES.targetExceedsOpen);
    }
    for (const t of target.targets) {
      rest -= take(t, t.amount, "explicit");
    }
  }

  if (rest > 0n && (target.mode === "fifo" || overflow === "fifo")) {
    for (const o of ordered) {
      if (rest <= 0n) break;
      rest -= take(o, rest, "fifo");
    }
  }

  const toObligations = amount - rest;
  if (rest > 0n) {
    lines.push({
      targetType: "credit",
      id: null,
      amount: rest,
      openBefore: 0n,
      openAfter: 0n,
      mode: target.mode === "fifo" ? "fifo" : restMode,
    });
  }
  return { lines, toObligations, toCredit: rest, adjusted };
}

/** Open balance of each obligation = original − Σ allocations (never below 0 for display). */
export function openBalances<T extends { kind: ObligationKind; id: string; original: bigint }>(
  obligations: ReadonlyArray<T>,
  allocations: ReadonlyArray<{ targetType: string; saleId?: string | null; initialDebtId?: string | null; amount: bigint }>,
): Array<T & { open: bigint }> {
  const applied = new Map<string, bigint>();
  for (const a of allocations) {
    if (a.targetType === "sale" && a.saleId) {
      applied.set(`sale:${a.saleId}`, (applied.get(`sale:${a.saleId}`) ?? 0n) + a.amount);
    } else if (a.targetType === "initial_debt" && a.initialDebtId) {
      const k = `initial_debt:${a.initialDebtId}`;
      applied.set(k, (applied.get(k) ?? 0n) + a.amount);
    }
  }
  return obligations.map((o) => ({ ...o, open: o.original - (applied.get(`${o.kind}:${o.id}`) ?? 0n) }));
}

/**
 * Credit (saldo a favor) still available per source, oldest first. Positive
 * credit rows add to their source; negative rows of the same source release
 * it (credit_apply); credit_refund rows consume FIFO across sources.
 * C07: reversal rows count for their ORIGIN source (released money is
 * available again under the source that paid it; a payment reversal takes
 * its own saldo a favor back). A negative row larger than its source spills
 * FIFO over the others, so Σ available = credit_balance.
 */
export function creditBySource(
  rows: ReadonlyArray<{
    sourceType: string;
    sourceId: string;
    originSourceType?: string | null;
    originSourceId?: string | null;
    targetType: string;
    amount: bigint;
    createdAt: number;
    id: string;
  }>,
): Array<{ sourceType: string; sourceId: string; available: bigint }> {
  const ordered = [...rows]
    .filter((r) => r.targetType === "credit")
    .sort((a, b) => (a.createdAt !== b.createdAt ? a.createdAt - b.createdAt : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const queue: Array<{ sourceType: string; sourceId: string; available: bigint }> = [];
  const find = (t: string, id: string) => queue.find((q) => q.sourceType === t && q.sourceId === id);
  const consumeFifo = (amount: bigint) => {
    let left = amount;
    for (const q of queue) {
      if (left <= 0n) break;
      const x = minBig(left, q.available < 0n ? 0n : q.available);
      q.available -= x;
      left -= x;
    }
  };
  for (const r of ordered) {
    if (r.sourceType === "credit_refund") {
      consumeFifo(-r.amount);
      continue;
    }
    const isReversal = r.sourceType === "reversal";
    if (isReversal && !(r.originSourceType && r.originSourceId)) {
      if (r.amount < 0n) consumeFifo(-r.amount);
      continue;
    }
    const t = isReversal ? r.originSourceType! : r.sourceType;
    const id = isReversal ? r.originSourceId! : r.sourceId;
    let q = find(t, id);
    if (r.amount > 0n) {
      if (q) q.available += r.amount;
      else queue.push({ sourceType: t, sourceId: id, available: r.amount });
      continue;
    }
    if (!q) {
      q = { sourceType: t, sourceId: id, available: 0n };
      queue.push(q);
    }
    const own = minBig(-r.amount, q.available < 0n ? 0n : q.available);
    q.available -= own;
    consumeFifo(-r.amount - own);
  }
  return queue.filter((q) => q.available > 0n);
}
