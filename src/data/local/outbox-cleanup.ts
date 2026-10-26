import { addCop, subCop } from "@/domain/money";
import type { DulceCalleLocalDB } from "./db";
import type { OutboxItem } from "./types";

function effectApplied(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  return (payload as { optimisticApplied?: unknown }).optimisticApplied !== false;
}

/**
 * When two offline ops (e.g. preparation then surtir) both shift a product's
 * avgCost and are rejected in FIFO order, the earlier op's pre-op avgCost is
 * the baseline that the next still-applied op on that product should restore if
 * it is also rejected.
 */
async function propagatePrevAvgToNextPendingOp(
  db: DulceCalleLocalDB,
  businessId: string,
  currentOp: OutboxItem,
  productId: string,
  prevAvg: number,
): Promise<void> {
  const all = await db.outbox.where("businessId").equals(businessId).toArray();
  const later = all
    .filter(
      (o) =>
        o.operationId !== currentOp.operationId &&
        o.status !== "synced" &&
        effectApplied(o.payload) &&
        o.localCreatedAt >= currentOp.localCreatedAt &&
        ((o.entity === "stockMove" &&
          o.operation === "surtir" &&
          (o.payload as Record<string, unknown> | null)?.productId === productId) ||
          (o.entity === "preparation" &&
            o.operation === "create" &&
            (o.payload as Record<string, unknown> | null)?.targetId === productId)),
    )
    .sort((a, b) => a.localCreatedAt - b.localCreatedAt);
  const next = later[0];
  if (!next || !next.payload || typeof next.payload !== "object") return;
  const p = next.payload as Record<string, unknown>;
  const key = next.entity === "preparation" ? "prevTargetAvgCost" : "prevAvgCost";
  await db.outbox.put({
    ...next,
    payload: { ...p, [key]: prevAvg },
  });
}

/**
 * R2-A A1: Revert optimistic local effects (stock, avgCost, debt, cashMoves,
 * expenses, stockMoves, preparations) on permanent server rejection, and delete
 * local entity rows when the outbox operation is discarded so discarded intents
 * never reappear in statements, sales, caja, gastos, or inventory.
 */
export async function cleanupOutboxLocalEffect(
  db: DulceCalleLocalDB,
  businessId: string,
  row: OutboxItem,
  mode: "reject" | "discard",
): Promise<void> {
  const applied = effectApplied(row.payload);
  const raw =
    row.payload && typeof row.payload === "object"
      ? (row.payload as Record<string, unknown>)
      : {};
  const now = Date.now();
  const appliedAt =
    typeof raw.optimisticAppliedAt === "number" ? raw.optimisticAppliedAt : row.localCreatedAt;
  let productOverwrittenByServer = false;
  if (
    applied &&
    (row.entity === "sale" || row.entity === "stockMove" || row.entity === "preparation")
  ) {
    try {
      const productsMeta = await db.cacheMeta.get(`${businessId}::products`);
      productOverwrittenByServer =
        productsMeta != null && productsMeta.cachedAt > appliedAt;
    } catch {
      productOverwrittenByServer = false;
    }
  }

  if (row.entity === "sale" && row.operation === "create") {
    const sale = await db.sales.get(row.operationId);
    if (applied) {
      if (sale && sale.businessId === businessId && sale.credit > 0 && sale.customerId) {
        const customer = await db.customers.get(sale.customerId);
        if (customer && customer.businessId === businessId) {
          const next = subCop(customer.debt, sale.credit);
          await db.customers.put({
            ...customer,
            debt: next < 0 ? 0 : next,
            updatedAt: now,
          });
        }
      }
      const stockMoves = await db.stockMoves.where("businessId").equals(businessId).toArray();
      for (const move of stockMoves) {
        if (move.requestId !== row.requestId || move.reason !== "sale") continue;
        if (!productOverwrittenByServer) {
          const product = await db.products.get(move.productId);
          if (product && product.businessId === businessId) {
            await db.products.put({
              ...product,
              stock: product.stock - move.delta,
              updatedAt: now,
            });
          }
        }
        await db.stockMoves.delete(move.id);
      }
      const cashMoves = await db.cashMoves.where("businessId").equals(businessId).toArray();
      for (const move of cashMoves) {
        if (move.requestId !== row.requestId || move.refType !== "sale") continue;
        await db.cashMoves.delete(move.id);
      }
    }
    if (mode === "discard") {
      const lines = await db.saleLines
        .where("[businessId+saleId]")
        .equals([businessId, row.operationId])
        .toArray();
      for (const l of lines) await db.saleLines.delete(l.id);
      await db.sales.delete(row.operationId);
    }
  } else if (row.entity === "customerPayment" && row.operation === "pay") {
    const payment = await db.customerPayments.get(row.operationId);
    if (applied) {
      const customerId = payment?.customerId ?? (typeof raw.customerId === "string" ? raw.customerId : null);
      const amount = payment?.amount ?? (typeof raw.amount === "number" ? raw.amount : 0);
      if (customerId && amount > 0) {
        const customer = await db.customers.get(customerId);
        if (customer && customer.businessId === businessId) {
          await db.customers.put({
            ...customer,
            debt: addCop(customer.debt, amount),
            updatedAt: now,
          });
        }
      }
      const cashMoves = await db.cashMoves.where("businessId").equals(businessId).toArray();
      for (const move of cashMoves) {
        if (move.requestId !== row.requestId || move.refType !== "customer_payment") continue;
        await db.cashMoves.delete(move.id);
      }
    }
    if (mode === "discard") {
      await db.customerPayments.delete(row.operationId);
    }
  } else if (row.entity === "initialDebt" && row.operation === "create") {
    const debtRow = await db.initialDebts.get(row.operationId);
    if (applied) {
      const customerId = debtRow?.customerId ?? (typeof raw.customerId === "string" ? raw.customerId : null);
      const amount = debtRow?.amount ?? (typeof raw.amount === "number" ? raw.amount : 0);
      if (customerId && amount > 0) {
        const customer = await db.customers.get(customerId);
        if (customer && customer.businessId === businessId) {
          const next = subCop(customer.debt, amount);
          await db.customers.put({
            ...customer,
            debt: next < 0 ? 0 : next,
            updatedAt: now,
          });
        }
      }
    }
    if (mode === "discard") {
      await db.initialDebts.delete(row.operationId);
    }
  } else if (row.entity === "saleReturn" && row.operation === "return") {
    if (applied) {
      const reduced = typeof raw.projectedDebtReduced === "number" ? raw.projectedDebtReduced : 0;
      const saleRef = typeof raw.saleRef === "string" ? raw.saleRef : null;
      if (reduced > 0 && saleRef) {
        const sale = await db.sales.get(saleRef);
        if (sale && sale.businessId === businessId && sale.customerId) {
          const customer = await db.customers.get(sale.customerId);
          if (customer && customer.businessId === businessId) {
            await db.customers.put({
              ...customer,
              debt: addCop(customer.debt, reduced),
              updatedAt: now,
            });
          }
        }
      }
    }
  } else if (row.entity === "cashMove" && row.operation === "create") {
    await db.cashMoves.delete(row.operationId);
  } else if (row.entity === "expense" && row.operation === "create") {
    await db.expenses.delete(row.operationId);
    const cashMoves = await db.cashMoves.where("businessId").equals(businessId).toArray();
    for (const move of cashMoves) {
      if (move.refId === row.operationId || (move.kind === "expense" && move.requestId === row.requestId)) {
        await db.cashMoves.delete(move.id);
      }
    }
  } else if (row.entity === "stockMove" && row.operation === "surtir") {
    if (applied && !productOverwrittenByServer) {
      const productId = typeof raw.productId === "string" ? raw.productId : null;
      const qty = typeof raw.qty === "number" ? raw.qty : 0;
      if (productId && qty > 0) {
        const product = await db.products.get(productId);
        if (product && product.businessId === businessId) {
          const isPool = product.sellable === false || product.kind === "combo";
          const surtirCost =
            typeof raw.totalCost === "number"
              ? raw.totalCost
              : (typeof raw.unitCost === "number" ? raw.unitCost : 0) * qty;
          const prevAvg = isPool
            ? Math.max(0, (product.avgCost ?? 0) - surtirCost)
            : typeof raw.prevAvgCost === "number"
              ? raw.prevAvgCost
              : product.avgCost;
          await db.products.put({
            ...product,
            stock: Math.max(0, product.stock - qty),
            avgCost: prevAvg,
            updatedAt: now,
          });
          if (!isPool) {
            await propagatePrevAvgToNextPendingOp(db, businessId, row, productId, prevAvg);
          }
        }
      }
    }
    await db.stockMoves.delete(row.operationId);
    const cashMoves = await db.cashMoves.where("businessId").equals(businessId).toArray();
    for (const move of cashMoves) {
      if (move.refType === "stockMove" && move.refId === row.operationId) {
        await db.cashMoves.delete(move.id);
      }
    }
  } else if (row.entity === "stockMove" && row.operation === "shrink") {
    if (applied && !productOverwrittenByServer) {
      const productId = typeof raw.productId === "string" ? raw.productId : null;
      const qty = typeof raw.qty === "number" ? raw.qty : 0;
      if (productId && qty > 0) {
        const product = await db.products.get(productId);
        if (product && product.businessId === businessId) {
          await db.products.put({
            ...product,
            stock: product.stock + qty,
            updatedAt: now,
          });
        }
      }
    }
    await db.stockMoves.delete(row.operationId);
  } else if (row.entity === "preparation" && row.operation === "create") {
    if (applied && !productOverwrittenByServer) {
      const sourceId = typeof raw.sourceId === "string" ? raw.sourceId : null;
      const targetId = typeof raw.targetId === "string" ? raw.targetId : null;
      const qty = typeof raw.qty === "number" ? raw.qty : 0;
      const unitCost = typeof raw.unitCost === "number" ? raw.unitCost : 0;
      if (targetId && qty > 0) {
        const target = await db.products.get(targetId);
        if (target && target.businessId === businessId) {
          const prevTargetAvg =
            typeof raw.prevTargetAvgCost === "number" ? raw.prevTargetAvgCost : target.avgCost;
          await db.products.put({
            ...target,
            stock: Math.max(0, target.stock - qty),
            avgCost: prevTargetAvg,
            updatedAt: now,
          });
          await propagatePrevAvgToNextPendingOp(db, businessId, row, targetId, prevTargetAvg);
        }
      }
      if (sourceId && qty > 0 && unitCost > 0) {
        const source = await db.products.get(sourceId);
        if (source && source.businessId === businessId) {
          const restoredSourceAvg = source.avgCost + unitCost * qty;
          await db.products.put({
            ...source,
            avgCost: restoredSourceAvg,
            updatedAt: now,
          });
        }
      }
    }
    await db.preparations.delete(row.operationId);
    const stockMoves = await db.stockMoves.where("businessId").equals(businessId).toArray();
    for (const move of stockMoves) {
      if (move.refType === "preparation" && move.refId === row.operationId) {
        await db.stockMoves.delete(move.id);
      }
    }
  } else if (row.entity === "cashSession" && row.operation === "open" && mode === "discard") {
    await db.cashSessions.delete(row.operationId);
  }

  if (mode === "reject" && applied) {
    const current = await db.outbox.get(row.operationId);
    if (current && current.businessId === businessId && current.payload && typeof current.payload !== "string") {
      await db.outbox.put({
        ...current,
        payload: { ...(current.payload as Record<string, unknown>), optimisticApplied: false },
      });
    }
  }
}
