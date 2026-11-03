import type { DulceCalleLocalDB } from "./db";
import type { OutboxItem } from "./types";

/** Outbox operations that move money or change a customer's debt. */
export function isFinancialOp(op: Pick<OutboxItem, "entity" | "operation">): boolean {
  const key = `${op.entity}:${op.operation}`;
  return (
    key === "sale:create" ||
    key === "customerPayment:pay" ||
    key === "saleReturn:return" ||
    key === "initialDebt:create" ||
    key === "expense:create" ||
    key === "cashMove:create" ||
    key === "stockMove:surtir"
  );
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

/**
 * Amount and customer an operation stands for, read from its payload or its
 * local row. Display/audit only: never used to compute balances.
 */
export async function summarizeOutboxMoney(
  db: DulceCalleLocalDB,
  op: OutboxItem,
): Promise<{ amount: number | null; customerId: string | null }> {
  const p = op.payload && typeof op.payload === "object" ? (op.payload as Record<string, unknown>) : {};
  let customerId = typeof p.customerId === "string" ? p.customerId : null;
  let amount = num(p.amount);
  if (op.entity === "sale" && op.operation === "create") {
    const sale = await db.sales.get(op.operationId);
    if (sale) {
      amount = sale.saleTotal;
      customerId = sale.customerId ?? customerId;
    }
  } else if (op.entity === "saleReturn") {
    const refund = num(p.projectedRefundAmount) ?? 0;
    const reduced = num(p.projectedDebtReduced) ?? 0;
    amount = refund + reduced;
    if (typeof p.saleRef === "string") {
      const sale = await db.sales.get(p.saleRef);
      customerId = sale?.customerId ?? customerId;
    }
  } else if (op.entity === "stockMove" && op.operation === "surtir") {
    amount = num(p.totalCost) ?? (num(p.unitCost) != null && num(p.qty) != null ? num(p.unitCost)! * num(p.qty)! : null);
  }
  return { amount, customerId };
}
