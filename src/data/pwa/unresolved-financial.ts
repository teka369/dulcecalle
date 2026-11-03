import { getLocalDb } from "../local/db";
import { isFinancialOp, summarizeOutboxMoney } from "../local/outbox-money";
import type { OutboxItem } from "../local/types";

export type UnresolvedFinancialOp = {
  operationId: string;
  entity: OutboxItem["entity"];
  operation: OutboxItem["operation"];
  /** «Rechazada» (permanent server rejection) or still waiting to sync. */
  state: "rejected" | "pending";
  amount: number | null;
  customerId: string | null;
  /** Server reason in Spanish, as received. */
  reason: string | null;
  code: string | null;
  localCreatedAt: number;
};

export function isRejectedOp(op: Pick<OutboxItem, "status" | "nextAttemptAt">): boolean {
  return op.status === "failed" && op.nextAttemptAt == null;
}

/**
 * C01 — Money operations of this device that the server has not confirmed:
 * rejected ones (kept until the owner resolves them) and pending ones.
 * Oldest first, like the sync engine.
 */
export async function listUnresolvedFinancialOps(
  businessId: string,
  opts: { customerId?: string } = {},
): Promise<UnresolvedFinancialOp[]> {
  const db = getLocalDb();
  const rows = await db.outbox.where("businessId").equals(businessId).toArray();
  const out: UnresolvedFinancialOp[] = [];
  for (const op of rows.sort((a, b) => a.localCreatedAt - b.localCreatedAt)) {
    if (op.status === "synced" || !isFinancialOp(op)) continue;
    const { amount, customerId } = await summarizeOutboxMoney(db, op);
    if (opts.customerId && customerId !== opts.customerId) continue;
    out.push({
      operationId: op.operationId,
      entity: op.entity,
      operation: op.operation,
      state: isRejectedOp(op) ? "rejected" : "pending",
      amount,
      customerId,
      reason: op.lastError,
      code: op.rejection?.code ?? null,
      localCreatedAt: op.localCreatedAt,
    });
  }
  return out;
}

export function unresolvedTotals(ops: UnresolvedFinancialOp[]) {
  const rejected = ops.filter((o) => o.state === "rejected");
  const pending = ops.filter((o) => o.state === "pending");
  const sum = (list: UnresolvedFinancialOp[]) => list.reduce((s, o) => s + (o.amount ?? 0), 0);
  return {
    rejectedCount: rejected.length,
    rejectedAmount: sum(rejected),
    pendingCount: pending.length,
    pendingAmount: sum(pending),
  };
}
