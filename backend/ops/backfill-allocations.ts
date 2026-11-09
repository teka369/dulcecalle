/**
 * C04-PR7 — deterministic backfill of debt_allocations for history written
 * before C04 (SPEC-C04 §8). Dry-run by default; `--apply` writes.
 *
 *   npx ts-node ops/backfill-allocations.ts            # dry-run, all businesses
 *   npx ts-node ops/backfill-allocations.ts --apply    # writes
 *   ... --business <uuid>                              # one business
 *
 * Never touches customers.debt. Per customer, in one transaction under the
 * business advisory lock:
 *  - obligations = sales with credit > 0 + initial debts;
 *  - events = payments and returns with debtReduced > 0, by (createdAt, id);
 *  - an obligation is eligible once obligation.createdAt ≤ event.createdAt;
 *  - return → its own sale first, then FIFO; payment → FIFO; leftovers →
 *    credit (reported: the old server never accepted an overpayment);
 *  - sources that already have rows (live C04 writes or an earlier run) are
 *    replayed, never rewritten (idempotent);
 *  - Σ open ≠ customers.debt → DEBT_MISMATCH: nothing is written for that
 *    customer (decision 9: no balance is overwritten).
 *
 * Production / Neon: refused unless BACKFILL_PROD_APPROVED=1 (only with Juan's
 * explicit approval and after the C05 backup).
 */
import { randomUUID } from "crypto";
import { Prisma, PrismaClient } from "@prisma/client";

type Ob = { kind: "sale" | "initial_debt"; id: string; occurredOn: string; createdAt: Date; original: bigint; open: bigint };
/** `replay` = a source that only has existing rows (e.g. credit_refund). */
type Ev = { kind: "payment" | "sale_return" | "replay"; id: string; saleId: string | null; amount: bigint; createdAt: Date; replayKey?: string };

export type PlannedRow = {
  sourceType: "payment" | "sale_return";
  sourceId: string;
  targetType: "sale" | "initial_debt" | "credit";
  targetId: string | null;
  amount: bigint;
  createdAt: Date;
};

export type CustomerReport = {
  businessId: string;
  customerId: string;
  status: "ok" | "DEBT_MISMATCH";
  storedDebt: bigint;
  reconstructedDebt: bigint;
  planned: PlannedRow[];
  written: number;
  unexpectedCredit: bigint;
};

export type BackfillReport = {
  apply: boolean;
  customers: CustomerReport[];
  rowsPlanned: number;
  rowsWritten: number;
  mismatches: number;
};

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function fifo(a: Ob, b: Ob): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? -1 : 1;
  if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Pure walk (exported for unit tests). Mutates `obligations[].open`. */
export function planCustomer(
  obligations: Ob[],
  events: Ev[],
  existing: Map<string, Array<{ targetType: string; saleId: string | null; initialDebtId: string | null; amount: bigint }>>,
): { rows: PlannedRow[]; unexpectedCredit: bigint } {
  const rows: PlannedRow[] = [];
  let unexpectedCredit = 0n;
  const byKey = new Map(obligations.map((o) => [`${o.kind}:${o.id}`, o]));
  const sorted = [...events].sort((a, b) =>
    a.createdAt.getTime() !== b.createdAt.getTime() ? a.createdAt.getTime() - b.createdAt.getTime() : a.id < b.id ? -1 : 1,
  );
  for (const ev of sorted) {
    const prior = existing.get(ev.replayKey ?? `${ev.kind}:${ev.id}`);
    if (prior && prior.length > 0) {
      // Already allocated: replay its effect on open balances, write nothing.
      for (const r of prior) {
        const key = r.targetType === "sale" ? `sale:${r.saleId}` : r.targetType === "initial_debt" ? `initial_debt:${r.initialDebtId}` : null;
        const o = key ? byKey.get(key) : undefined;
        if (o) o.open -= r.amount;
      }
      continue;
    }
    if (ev.kind === "replay") continue;
    let left = ev.amount;
    const eligible = obligations.filter((o) => o.createdAt.getTime() <= ev.createdAt.getTime()).sort(fifo);
    const take = (o: Ob) => {
      if (left <= 0n || o.open <= 0n) return;
      const x = left < o.open ? left : o.open;
      o.open -= x;
      left -= x;
      rows.push({ sourceType: ev.kind as PlannedRow["sourceType"], sourceId: ev.id, targetType: o.kind, targetId: o.id, amount: x, createdAt: ev.createdAt });
    };
    if (ev.kind === "sale_return" && ev.saleId) {
      const own = byKey.get(`sale:${ev.saleId}`);
      if (own) take(own);
    }
    for (const o of eligible) take(o);
    if (left > 0n) {
      unexpectedCredit += left;
      rows.push({ sourceType: ev.kind as PlannedRow["sourceType"], sourceId: ev.id, targetType: "credit", targetId: null, amount: left, createdAt: ev.createdAt });
    }
  }
  return { rows, unexpectedCredit };
}

async function backfillCustomer(
  prisma: PrismaClient,
  businessId: string,
  customerId: string,
  apply: boolean,
): Promise<CustomerReport> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}))`;
    const customer = await tx.customer.findFirstOrThrow({ where: { id: customerId, businessId } });
    const [sales, initials, payments, returns, existingRows] = await Promise.all([
      tx.sale.findMany({ where: { businessId, customerId, credit: { gt: 0n } }, select: { id: true, occurredOn: true, createdAt: true, credit: true } }),
      tx.initialDebt.findMany({ where: { businessId, customerId }, select: { id: true, occurredOn: true, createdAt: true, amount: true } }),
      tx.customerPayment.findMany({ where: { businessId, customerId }, select: { id: true, amount: true, createdAt: true } }),
      tx.saleReturn.findMany({
        where: { businessId, debtReduced: { gt: 0n }, sale: { customerId } },
        select: { id: true, saleId: true, debtReduced: true, createdAt: true },
      }),
      tx.debtAllocation.findMany({
        where: { businessId, customerId },
        select: { sourceType: true, sourceId: true, targetType: true, saleId: true, initialDebtId: true, amount: true, createdAt: true },
      }),
    ]);
    const obligations: Ob[] = [
      ...sales.map((s) => ({ kind: "sale" as const, id: s.id, occurredOn: dayKey(s.occurredOn), createdAt: s.createdAt, original: s.credit, open: s.credit })),
      ...initials.map((d) => ({ kind: "initial_debt" as const, id: d.id, occurredOn: dayKey(d.occurredOn), createdAt: d.createdAt, original: d.amount, open: d.amount })),
    ];
    const events: Ev[] = [
      ...payments.map((p) => ({ kind: "payment" as const, id: p.id, saleId: null, amount: p.amount, createdAt: p.createdAt })),
      ...returns.map((r) => ({ kind: "sale_return" as const, id: r.id, saleId: r.saleId, amount: r.debtReduced, createdAt: r.createdAt })),
    ];
    const existing = new Map<string, typeof existingRows>();
    for (const r of existingRows) {
      const k = `${r.sourceType}:${r.sourceId}`;
      existing.set(k, [...(existing.get(k) ?? []), r]);
    }
    // Sources with rows but no legacy event (credit refunds, returns fully to
    // credit): replay them in time order too.
    const eventKeys = new Set(events.map((e) => `${e.kind}:${e.id}`));
    for (const [k, list] of existing) {
      if (eventKeys.has(k)) continue;
      const first = list.reduce((m, r) => (r.createdAt < m ? r.createdAt : m), list[0].createdAt);
      events.push({ kind: "replay", id: k, saleId: null, amount: 0n, createdAt: first, replayKey: k });
    }
    const { rows, unexpectedCredit } = planCustomer(obligations, events, existing);
    const reconstructedDebt = obligations.reduce((a, o) => a + (o.open > 0n ? o.open : 0n), 0n);
    const base = { businessId, customerId, storedDebt: customer.debt, reconstructedDebt, planned: rows, unexpectedCredit };
    if (reconstructedDebt !== customer.debt) {
      return { ...base, status: "DEBT_MISMATCH" as const, written: 0 };
    }
    if (!apply || rows.length === 0) return { ...base, status: "ok" as const, written: 0 };
    await tx.debtAllocation.createMany({
      data: rows.map((r, i) => ({
        id: randomUUID(),
        businessId,
        customerId,
        sourceType: r.sourceType,
        sourceId: r.sourceId,
        targetType: r.targetType,
        saleId: r.targetType === "sale" ? r.targetId : null,
        initialDebtId: r.targetType === "initial_debt" ? r.targetId : null,
        amount: r.amount,
        mode: "backfill" as const,
        groupId: r.sourceId,
        createdAt: new Date(r.createdAt.getTime() + i),
        createdBy: null,
      })),
    });
    const toCredit = rows.filter((r) => r.targetType === "credit").reduce((a, r) => a + r.amount, 0n);
    if (toCredit > 0n) {
      await tx.customer.update({ where: { id: customerId }, data: { creditBalance: { increment: toCredit } } });
    }
    return { ...base, status: "ok" as const, written: rows.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000 });
}

export async function runBackfill(
  prisma: PrismaClient,
  opts: { apply: boolean; businessId?: string },
): Promise<BackfillReport> {
  const customers = await prisma.customer.findMany({
    where: opts.businessId ? { businessId: opts.businessId } : {},
    select: { id: true, businessId: true },
    orderBy: [{ businessId: "asc" }, { id: "asc" }],
  });
  const reports: CustomerReport[] = [];
  for (const c of customers) reports.push(await backfillCustomer(prisma, c.businessId, c.id, opts.apply));
  return {
    apply: opts.apply,
    customers: reports,
    rowsPlanned: reports.reduce((a, r) => a + r.planned.length, 0),
    rowsWritten: reports.reduce((a, r) => a + r.written, 0),
    mismatches: reports.filter((r) => r.status === "DEBT_MISMATCH").length,
  };
}

export function assertSafeTarget(url: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const looksProd = /neon\.tech|\bprod\b|production/i.test(url);
  if (looksProd && env.BACKFILL_PROD_APPROVED !== "1") {
    throw new Error("Refusing to run against a production database without BACKFILL_PROD_APPROVED=1 (Juan's approval).");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const bi = args.indexOf("--business");
  const businessId = bi >= 0 ? args[bi + 1] : undefined;
  assertSafeTarget(process.env.DATABASE_URL);
  const prisma = new PrismaClient();
  try {
    const report = await runBackfill(prisma, { apply, ...(businessId ? { businessId } : {}) });
    for (const c of report.customers) {
      if (c.status === "DEBT_MISMATCH") {
        console.log(`DEBT_MISMATCH business=${c.businessId} customer=${c.customerId} stored=${c.storedDebt} reconstructed=${c.reconstructedDebt}`);
      }
      if (c.unexpectedCredit > 0n) {
        console.log(`UNEXPECTED_CREDIT business=${c.businessId} customer=${c.customerId} amount=${c.unexpectedCredit}`);
      }
    }
    console.log(
      `${apply ? "APPLY" : "DRY-RUN"} customers=${report.customers.length} rowsPlanned=${report.rowsPlanned} rowsWritten=${report.rowsWritten} mismatches=${report.mismatches}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
