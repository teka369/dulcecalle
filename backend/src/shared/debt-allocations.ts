import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { AppError, ERROR_CODES, MESSAGES } from "./errors";
import { dateKey } from "./clock";
import { copToJson, MAX_COP_AMOUNT } from "./money";
import {
  AllocationInvalidError,
  creditBySource,
  planAllocation,
  type AllocationPlan,
  type AllocationTargetInput,
  type Obligation,
  type Overflow,
} from "./allocation";

/**
 * C04 — DB side of debt allocation. Every function here runs inside the
 * caller's transaction, after the per-business advisory lock (R8).
 */
type Tx = Prisma.TransactionClient;

export type AllocationRowInput = {
  businessId: string;
  customerId: string;
  sourceType: "payment" | "sale_return" | "credit_refund";
  sourceId: string;
  targetType: "sale" | "initial_debt" | "credit";
  saleId?: string | null;
  initialDebtId?: string | null;
  amount: bigint;
  mode: "fifo" | "explicit" | "backfill" | "credit_apply";
  groupId: string;
  createdAt: Date;
  createdBy: string | null;
};

/** Allocation line as returned by the API (openBefore/openAfter when known). */
export type AllocationJson = {
  targetType: "sale" | "initial_debt" | "credit";
  saleId: string | null;
  initialDebtId: string | null;
  amount: number;
  openBefore: number | null;
  openAfter: number | null;
};

/** All obligations (sales with credit > 0 and initial debts) with their open balance. */
export async function loadObligations(
  tx: Tx,
  businessId: string,
  customerId: string,
): Promise<Obligation[]> {
  const [sales, initials, allocs] = await Promise.all([
    tx.sale.findMany({
      where: { businessId, customerId, credit: { gt: 0n } },
      select: { id: true, occurredOn: true, createdAt: true, credit: true },
    }),
    tx.initialDebt.findMany({
      where: { businessId, customerId },
      select: { id: true, occurredOn: true, createdAt: true, amount: true },
    }),
    tx.debtAllocation.groupBy({
      by: ["targetType", "saleId", "initialDebtId"],
      where: { businessId, customerId, targetType: { not: "credit" } },
      _sum: { amount: true },
    }),
  ]);
  const applied = new Map<string, bigint>();
  for (const a of allocs) {
    const key = a.targetType === "sale" ? `sale:${a.saleId}` : `initial_debt:${a.initialDebtId}`;
    applied.set(key, (applied.get(key) ?? 0n) + (a._sum.amount ?? 0n));
  }
  return [
    ...sales.map((s) => ({
      kind: "sale" as const,
      id: s.id,
      occurredOn: dateKey(s.occurredOn),
      createdAt: s.createdAt.getTime(),
      original: s.credit,
      open: s.credit - (applied.get(`sale:${s.id}`) ?? 0n),
    })),
    ...initials.map((d) => ({
      kind: "initial_debt" as const,
      id: d.id,
      occurredOn: dateKey(d.occurredOn),
      createdAt: d.createdAt.getTime(),
      original: d.amount,
      open: d.amount - (applied.get(`initial_debt:${d.id}`) ?? 0n),
    })),
  ];
}

export type PaymentTarget =
  | { mode: "fifo" }
  | { mode: "sale"; saleId?: string; saleRequestId?: string }
  | { mode: "split"; targets: Array<{ saleId?: string; initialDebtId?: string; amount: number }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badTarget(): never {
  throw new AppError(ERROR_CODES.VALIDATION, "Revisa a qué compra se aplica.");
}

function uuidOrUndefined(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v !== "string" || !UUID_RE.test(v)) badTarget();
  return v.toLowerCase();
}

/** Canonical target (C04 §6.1). Omitted → {mode:"fifo"}. Malformed → 400 VALIDATION. */
export function parseTarget(raw: unknown, allowSaleRequestId = true): PaymentTarget {
  if (raw == null) return { mode: "fifo" };
  if (typeof raw !== "object" || Array.isArray(raw)) badTarget();
  const r = raw as Record<string, unknown>;
  const allowed = new Set(["mode", "saleId", "saleRequestId", "targets"]);
  for (const k of Object.keys(r)) if (!allowed.has(k)) badTarget();
  if (r.mode === "fifo") {
    if (r.saleId != null || r.saleRequestId != null || r.targets != null) badTarget();
    return { mode: "fifo" };
  }
  if (r.mode === "sale") {
    if (r.targets != null) badTarget();
    const saleId = uuidOrUndefined(r.saleId);
    const saleRequestId = allowSaleRequestId ? uuidOrUndefined(r.saleRequestId) : r.saleRequestId == null ? undefined : badTarget();
    if (!saleId && !saleRequestId) badTarget();
    return {
      mode: "sale",
      ...(saleId ? { saleId } : {}),
      ...(saleRequestId ? { saleRequestId } : {}),
    };
  }
  if (r.mode === "split") {
    if (r.saleId != null || r.saleRequestId != null) badTarget();
    if (!Array.isArray(r.targets) || r.targets.length === 0 || r.targets.length > 50) badTarget();
    const targets = r.targets.map((t) => {
      if (!t || typeof t !== "object" || Array.isArray(t)) badTarget();
      const o = t as Record<string, unknown>;
      for (const k of Object.keys(o)) if (!["saleId", "initialDebtId", "amount"].includes(k)) badTarget();
      const saleId = uuidOrUndefined(o.saleId);
      const initialDebtId = uuidOrUndefined(o.initialDebtId);
      if ((saleId ? 1 : 0) + (initialDebtId ? 1 : 0) !== 1) badTarget();
      const amount = o.amount;
      if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 1 || amount > MAX_COP_AMOUNT) badTarget();
      return { ...(saleId ? { saleId } : { initialDebtId }), amount };
    });
    return { mode: "split", targets };
  }
  return badTarget();
}

export function parseOverflow(raw: unknown): Overflow {
  if (raw == null || raw === "fifo") return "fifo";
  if (raw === "credit") return "credit";
  throw new AppError(ERROR_CODES.VALIDATION, "Elige qué hacer con lo que sobra.");
}

/**
 * Fields added to the C02 payment hash. Defaults (fifo + fifo) add nothing,
 * so an omitted target hashes like `{mode:"fifo"}` AND like a pre-C04 row
 * (4-field hash). C03: `occurredAt` is never part of the hash.
 */
export function targetHashFields(target: PaymentTarget, overflow: Overflow): Record<string, unknown> {
  if (target.mode === "fifo") return {};
  return { target, overflow };
}

function invalid(message: string = MESSAGES.allocationInvalid): never {
  throw new AppError(ERROR_CODES.ALLOCATION_INVALID, message);
}

/**
 * Resolve a canonical target against the DB (business + customer scoped) into
 * the pure-planner input. Unknown / other customer / other business →
 * 422 ALLOCATION_INVALID (also with X-Offline-Replay: decision 16).
 */
export async function resolveTarget(
  tx: Tx,
  businessId: string,
  customerId: string,
  target: PaymentTarget,
  obligations: Obligation[],
): Promise<{ input: AllocationTargetInput; obligations: Obligation[] }> {
  if (target.mode === "fifo") return { input: { mode: "fifo" }, obligations };
  if (target.mode === "sale") {
    const sale = target.saleId
      ? await tx.sale.findFirst({ where: { id: target.saleId, businessId } })
      : await tx.sale.findUnique({
          where: { businessId_requestId: { businessId, requestId: target.saleRequestId! } },
        });
    if (!sale || sale.customerId !== customerId) invalid();
    if (target.saleId && target.saleRequestId && sale.requestId !== target.saleRequestId) invalid();
    const list = obligations.some((o) => o.kind === "sale" && o.id === sale.id)
      ? obligations
      : [
          ...obligations,
          // A sale without credit (paid) is "already settled" (§6.3).
          {
            kind: "sale" as const,
            id: sale.id,
            occurredOn: dateKey(sale.occurredOn),
            createdAt: sale.createdAt.getTime(),
            original: 0n,
            open: 0n,
          },
        ];
    return { input: { mode: "sale", saleId: sale.id }, obligations: list };
  }
  const list = [...obligations];
  const targets: Array<{ kind: "sale" | "initial_debt"; id: string; amount: bigint }> = [];
  for (const t of target.targets) {
    if (t.saleId) {
      const sale = await tx.sale.findFirst({ where: { id: t.saleId, businessId }, select: { id: true, customerId: true, occurredOn: true, createdAt: true } });
      if (!sale || sale.customerId !== customerId) invalid();
      if (!list.some((o) => o.kind === "sale" && o.id === sale.id)) {
        list.push({ kind: "sale", id: sale.id, occurredOn: dateKey(sale.occurredOn), createdAt: sale.createdAt.getTime(), original: 0n, open: 0n });
      }
      targets.push({ kind: "sale", id: sale.id, amount: BigInt(t.amount) });
    } else {
      const d = await tx.initialDebt.findFirst({ where: { id: t.initialDebtId!, businessId }, select: { id: true, customerId: true } });
      if (!d || d.customerId !== customerId) invalid();
      targets.push({ kind: "initial_debt", id: d.id, amount: BigInt(t.amount) });
    }
  }
  return { input: { mode: "split", targets }, obligations: list };
}

/** Pure planner with domain errors mapped to 422 ALLOCATION_INVALID. */
export function planOrThrow(args: Parameters<typeof planAllocation>[0]): AllocationPlan {
  try {
    return planAllocation(args);
  } catch (e) {
    if (e instanceof AllocationInvalidError) invalid(e.message);
    throw e;
  }
}

export function planLinesJson(plan: AllocationPlan): AllocationJson[] {
  return plan.lines.map((l) => ({
    targetType: l.targetType,
    saleId: l.targetType === "sale" ? l.id : null,
    initialDebtId: l.targetType === "initial_debt" ? l.id : null,
    amount: copToJson(l.amount),
    openBefore: l.targetType === "credit" ? null : copToJson(l.openBefore),
    openAfter: l.targetType === "credit" ? null : copToJson(l.openAfter),
  }));
}

export async function insertAllocations(tx: Tx, rows: AllocationRowInput[]): Promise<void> {
  if (rows.length === 0) return;
  await tx.debtAllocation.createMany({
    // +i ms keeps the written order (own sale, FIFO, credit) stable when read
    // back ordered by (created_at, id); ids are random UUIDs.
    data: rows.map((r, i) => ({
      id: randomUUID(),
      businessId: r.businessId,
      customerId: r.customerId,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      targetType: r.targetType,
      saleId: r.targetType === "sale" ? r.saleId ?? null : null,
      initialDebtId: r.targetType === "initial_debt" ? r.initialDebtId ?? null : null,
      amount: r.amount,
      mode: r.mode,
      groupId: r.groupId,
      createdAt: new Date(r.createdAt.getTime() + i),
      createdBy: r.createdBy,
    })),
  });
}

/** Stored-customer delta, guarded so debt / credit_balance never go below 0. */
export async function moveCustomerBalances(
  tx: Tx,
  businessId: string,
  customerId: string,
  delta: { debt: bigint; credit: bigint },
): Promise<void> {
  if (delta.debt === 0n && delta.credit === 0n) return;
  const n = await tx.$executeRaw`
    UPDATE customers
    SET debt = debt + ${delta.debt},
        credit_balance = credit_balance + ${delta.credit},
        updated_at = NOW()
    WHERE id = ${customerId}::uuid
      AND business_id = ${businessId}::uuid
      AND debt + ${delta.debt} >= 0
      AND credit_balance + ${delta.credit} >= 0
  `;
  if (Number(n) !== 1) {
    if (delta.credit < 0n) throw new AppError(ERROR_CODES.CREDIT_INSUFFICIENT, MESSAGES.creditInsufficient);
    throw new AppError(ERROR_CODES.VALIDATION, "debt must be ≥ 0");
  }
}

/**
 * R5 — apply saldo a favor to obligations. No cash. For each obligation line
 * a pair of rows with the same groupId: (credit, −x) and (obligation, +x),
 * mode credit_apply, attributed to the source(s) that created the credit so
 * Σ per source keeps equal to its amount (I-A1).
 */
export async function applyCreditToObligations(
  tx: Tx,
  args: {
    businessId: string;
    customerId: string;
    plan: AllocationPlan;
    groupId: string;
    createdBy: string | null;
    now: Date;
  },
): Promise<bigint> {
  const lines = args.plan.lines.filter((l) => l.targetType !== "credit");
  const total = lines.reduce((a, l) => a + l.amount, 0n);
  if (total === 0n) return 0n;
  const creditRows = await tx.debtAllocation.findMany({
    where: { businessId: args.businessId, customerId: args.customerId, targetType: "credit" },
    select: { id: true, sourceType: true, sourceId: true, targetType: true, amount: true, createdAt: true },
  });
  const sources = creditBySource(creditRows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })));
  const available = sources.reduce((a, s) => a + s.available, 0n);
  if (available < total) {
    throw new AppError(ERROR_CODES.CREDIT_INSUFFICIENT, MESSAGES.creditInsufficient);
  }
  const rows: AllocationRowInput[] = [];
  let si = 0;
  for (const line of lines) {
    let left = line.amount;
    while (left > 0n) {
      const src = sources[si]!;
      const x = left < src.available ? left : src.available;
      const base = {
        businessId: args.businessId,
        customerId: args.customerId,
        sourceType: src.sourceType as AllocationRowInput["sourceType"],
        sourceId: src.sourceId,
        mode: "credit_apply" as const,
        groupId: args.groupId,
        createdAt: args.now,
        createdBy: args.createdBy,
      };
      rows.push({ ...base, targetType: "credit", amount: -x });
      rows.push({
        ...base,
        targetType: line.targetType as "sale" | "initial_debt",
        saleId: line.targetType === "sale" ? line.id : null,
        initialDebtId: line.targetType === "initial_debt" ? line.id : null,
        amount: x,
      });
      src.available -= x;
      left -= x;
      if (src.available === 0n) si++;
    }
  }
  await insertAllocations(tx, rows);
  await moveCustomerBalances(tx, args.businessId, args.customerId, { debt: -total, credit: -total });
  return total;
}

/** API shape of stored rows (ledger / replay). Never includes createdBy unless asked. */
export function allocationRowJson(
  r: {
    id: string;
    sourceType: string;
    sourceId: string;
    targetType: string;
    saleId: string | null;
    initialDebtId: string | null;
    amount: bigint;
    mode: string;
    groupId: string;
    createdAt: Date;
    createdBy?: string | null;
  },
  withCreatedBy = false,
) {
  return {
    id: r.id,
    sourceType: r.sourceType,
    sourceId: r.sourceId,
    targetType: r.targetType,
    saleId: r.saleId,
    initialDebtId: r.initialDebtId,
    amount: copToJson(r.amount),
    mode: r.mode,
    groupId: r.groupId,
    createdAt: r.createdAt,
    ...(withCreatedBy ? { createdBy: r.createdBy ?? null } : {}),
  };
}
