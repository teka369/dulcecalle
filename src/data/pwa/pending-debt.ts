import { addCop, subCop } from "@/domain/money";
import { ApiError } from "../errors";
import { getLocalDb } from "../local/db";
import type { OutboxItem } from "../local/types";

/**
 * Debt still only on this device. Synced rows are already in the server
 * balance. A permanent failure (failed, no retry) is not a valid balance.
 */
export function isActiveDebtIntent(op: OutboxItem): boolean {
  if (op.status === "pending" || op.status === "in_flight") return true;
  return op.status === "failed" && op.nextAttemptAt != null;
}

export function isPermanentDebtRejection(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 400 ||
      error.status === 403 ||
      error.status === 404 ||
      error.status === 409 ||
      error.status === 422)
  );
}

/**
 * Hide a local financial row when the server rejected it, or when the
 * optimistic effect was rolled back and has not been re-applied yet.
 * 401 is not this case: the intent stays pending and the effect stays.
 */
export function isSuppressedLocalEffect(op: OutboxItem): boolean {
  if (op.status === "failed" && op.nextAttemptAt == null) return true;
  const raw = op.payload;
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as { optimisticApplied?: unknown }).optimisticApplied === false
  );
}

function payloadRecord(op: OutboxItem): Record<string, unknown> | null {
  if (!op.payload || typeof op.payload !== "object") return null;
  return op.payload as Record<string, unknown>;
}

function payloadCustomerId(op: OutboxItem): string | null {
  const row = payloadRecord(op);
  const id = row?.customerId;
  return typeof id === "string" ? id : null;
}

function payloadAmount(op: OutboxItem, key: string): number {
  const row = payloadRecord(op);
  const value = row?.[key];
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

/**
 * Local effect of debt intents that the server snapshot does not include yet.
 * Positive increases debt. Excludes the operation just confirmed by that snapshot.
 */
export async function pendingDebtAdjustment(
  businessId: string,
  customerId: string,
  excludeOperationIds: string[] = [],
): Promise<number> {
  const db = getLocalDb();
  const excluded = new Set(excludeOperationIds);
  const ops = await db.outbox.where("businessId").equals(businessId).toArray();
  const confirmedReturns = new Set(
    (await db.saleReturns.where("businessId").equals(businessId).toArray()).map(
      (row) => row.requestId,
    ),
  );
  let delta = 0;
  for (const op of ops) {
    if (op.businessId !== businessId || excluded.has(op.operationId)) continue;
    if (!isActiveDebtIntent(op)) continue;
    if (isSuppressedLocalEffect(op)) continue;
    if (op.entity === "initialDebt" && op.operation === "create") {
      if (payloadCustomerId(op) !== customerId) continue;
      delta = addCop(delta, payloadAmount(op, "amount"));
      continue;
    }
    if (op.entity === "customerPayment" && op.operation === "pay") {
      if (payloadCustomerId(op) !== customerId) continue;
      delta = subCop(delta, payloadAmount(op, "amount"));
      continue;
    }
    if (op.entity === "sale" && op.operation === "create") {
      const sale = await db.sales.get(op.operationId);
      if (!sale || sale.businessId !== businessId || sale.customerId !== customerId) continue;
      if (sale.credit > 0) delta = addCop(delta, sale.credit);
      continue;
    }
    if (op.entity === "saleReturn" && op.operation === "return") {
      if (confirmedReturns.has(op.requestId)) continue;
      const reduced = payloadAmount(op, "projectedDebtReduced");
      if (reduced <= 0) continue;
      const saleRef = payloadRecord(op)?.saleRef;
      if (typeof saleRef !== "string") continue;
      const sale = await db.sales.get(saleRef);
      if (!sale || sale.businessId !== businessId || sale.customerId !== customerId) continue;
      delta = subCop(delta, reduced);
    }
  }
  return delta;
}
