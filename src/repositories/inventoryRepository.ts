import { getDb } from "@/storage/db";
import type { StockMove, StockMoveReason } from "@/domain/types";
import { asCop } from "@/domain/money";

/** Integer weighted average cost. */
export function weightedAvgCost(
  oldStock: number,
  oldAvg: number,
  addQty: number,
  unitCost: number,
): number {
  if (addQty < 0) throw new Error("addQty must be ≥ 0");
  const newStock = oldStock + addQty;
  if (newStock <= 0) return asCop(oldAvg);
  const total = oldStock * asCop(oldAvg) + addQty * asCop(unitCost);
  return asCop(Math.round(total / newStock));
}

export class InventoryRepository {
  async listMoves(productId?: number): Promise<StockMove[]> {
    const db = getDb();
    if (productId !== undefined) {
      return db.stockMoves.where("productId").equals(productId).reverse().sortBy("createdAt");
    }
    return db.stockMoves.orderBy("createdAt").reverse().toArray();
  }

  /**
   * Apply a stock delta. Rejects if resulting stock would be < 0.
   * On positive surtir, updates weighted avgCost.
   */
  async applyMove(input: {
    productId: number;
    delta: number;
    reason: StockMoveReason;
    unitCost?: number;
    note?: string;
    refType?: string;
    refId?: number;
  }): Promise<number> {
    if (!Number.isInteger(input.delta) || input.delta === 0) {
      throw new Error("delta must be a non-zero integer");
    }

    const db = getDb();
    return db.transaction("rw", db.products, db.stockMoves, async () => {
      const product = await db.products.get(input.productId);
      if (!product) throw new Error("product not found");

      const nextStock = product.stock + input.delta;
      if (nextStock < 0) {
        throw new Error("stock insufficient (stock never negative)");
      }

      let nextAvg = product.avgCost;
      const unitCost = input.unitCost ?? product.avgCost;
      asCop(unitCost);

      if (input.delta > 0 && input.reason === "surtir") {
        nextAvg = weightedAvgCost(
          product.stock,
          product.avgCost,
          input.delta,
          unitCost,
        );
      }

      await db.products.update(product.id!, {
        stock: nextStock,
        avgCost: nextAvg,
        updatedAt: Date.now(),
      });

      return db.stockMoves.add({
        productId: input.productId,
        delta: input.delta,
        reason: input.reason,
        unitCost,
        refType: input.refType,
        refId: input.refId,
        note: input.note,
        createdAt: Date.now(),
      }) as Promise<number>;
    });
  }
}

export const inventoryRepository = new InventoryRepository();
