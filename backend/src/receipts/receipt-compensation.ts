import type { Prisma, PrismaClient } from "@prisma/client";
import { originOf, targetKeyOf } from "../shared/reversal-plan";
import { copString } from "../shared/canonical";

/**
 * C09-PR3.2 — how much of a standalone imputation (DC-I-, `credit/apply`
 * group) a reversal has compensated. Derived on read from the insert-only
 * `debt_allocations` rows, never stored and never written to the receipt.
 *
 * Rows are replayed per customer in (createdAt, id) order. Each positive row
 * on an obligation pushes (groupId, amount) on the stack of its (origin,
 * target); each negative row pops that stack newest first (the same
 * «undo the newest first» rule as the C07 plan). A pop made by a reversal
 * row is a compensation of the popped group by that reversal.
 */
export type Compensation = {
  /** Σ of the group's obligation rows (what DC-I- put on sales / initial debts). */
  total: bigint;
  /** Σ compensated by reversals. */
  compensated: bigint;
  /** Reversal ids that compensated part of the group, in order. */
  reversalIds: string[];
  /** C09-PR5.2 — how much each of those reversals compensated. */
  byReversal: Map<string, bigint>;
};

export async function imputationCompensations(
  db: Pick<PrismaClient, "debtAllocation"> | Prisma.TransactionClient,
  businessId: string,
  imputations: ReadonlyArray<{ groupId: string; customerId: string }>,
): Promise<Map<string, Compensation>> {
  const out = new Map<string, Compensation>();
  if (imputations.length === 0) return out;
  for (const i of imputations) out.set(i.groupId, { total: 0n, compensated: 0n, reversalIds: [], byReversal: new Map() });
  const customers = [...new Set(imputations.map((i) => i.customerId))];
  const rows = await db.debtAllocation.findMany({
    where: { businessId, customerId: { in: customers }, targetType: { not: "credit" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const stacks = new Map<string, Array<{ groupId: string; left: bigint }>>();
  for (const r of rows) {
    const key = `${r.customerId}|${originOf(r)}|${targetKeyOf(r)}`;
    const stack = stacks.get(key) ?? [];
    stacks.set(key, stack);
    if (r.amount > 0n) {
      stack.push({ groupId: r.groupId, left: r.amount });
      const mine = out.get(r.groupId);
      if (mine && r.sourceType !== "reversal") mine.total += r.amount;
      continue;
    }
    let need = -r.amount;
    while (need > 0n && stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const y = top.left < need ? top.left : need;
      top.left -= y;
      need -= y;
      if (top.left === 0n) stack.pop();
      const hit = out.get(top.groupId);
      if (hit && r.sourceType === "reversal") {
        hit.compensated += y;
        if (!hit.reversalIds.includes(r.sourceId)) hit.reversalIds.push(r.sourceId);
        hit.byReversal.set(r.sourceId, (hit.byReversal.get(r.sourceId) ?? 0n) + y);
      }
    }
  }
  return out;
}

/**
 * C09-PR5.2 (T01) — what THIS reversal compensated of each standalone
 * imputation (DC-I-) of the customer, computed in the reversal's transaction
 * right after its rows are written, and frozen in the DC-R- snapshot
 * (`compensates`). The business wipe deletes `debt_allocations`; the
 * insert-only receipts keep this, so the DC-I- status stays derivable.
 */
export async function compensatesFor(
  tx: Prisma.TransactionClient,
  businessId: string,
  customerId: string,
  reversalId: string,
): Promise<Array<{ receiptId: string; number: string; amount: string }>> {
  const imps = (
    await tx.receipt.findMany({
      where: { businessId, customerId, kind: "allocation", sourceType: "allocation" },
      select: { id: true, number: true, sourceId: true, snapshot: true },
      orderBy: { number: "asc" },
    })
  ).filter((r) => (r.snapshot as Record<string, unknown> | null)?.parent === null);
  if (imps.length === 0) return [];
  const comp = await imputationCompensations(tx, businessId, imps.map((r) => ({ groupId: r.sourceId, customerId })));
  return imps.flatMap((r) => {
    const y = comp.get(r.sourceId)?.byReversal.get(reversalId) ?? 0n;
    return y > 0n ? [{ receiptId: r.id, number: r.number, amount: copString(y) }] : [];
  });
}
