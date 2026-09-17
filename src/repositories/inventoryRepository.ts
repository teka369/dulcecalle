import { getDb } from "@/storage/db";
import type { PayMethod, StockMove, StockMoveReason } from "@/domain/types";
import { asCop } from "@/domain/money";
import {
  INVENTORY_ERRORS,
  reconcileSurtirCost,
  type ShrinkReason,
} from "@/domain/inventory";
import { assertDayEditable } from "./dayGuard";

/**
 * Integer weighted average cost.
 * Choice: Math.round (not floor) so COP stays integer and balances evenly.
 * Example: total 1000 / qty 3 → unit 333.
 */
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
   * On positive surtir, updates weighted avgCost (round).
   * Prefer surtir() / applyShrink() for S3 flows — this stays the low-level path
   * (Day-1 + sales must not duplicate shrink logic).
   */
  async applyMove(input: {
    productId: number;
    delta: number;
    reason: StockMoveReason;
    unitCost?: number;
    note?: string;
    refType?: string;
    refId?: number;
    supplierId?: number | null;
    createdAt?: number;
  }): Promise<number> {
    if (!Number.isInteger(input.delta) || input.delta === 0) {
      throw new Error("delta must be a non-zero integer");
    }

    const createdAt = input.createdAt ?? Date.now();
    await assertDayEditable(createdAt);

    const db = getDb();
    return db.transaction("rw", db.products, db.stockMoves, db.cashSessions, async () => {
      await assertDayEditable(createdAt);
      const product = await db.products.get(input.productId);
      if (!product) throw new Error("product not found");

      const nextStock = product.stock + input.delta;
      if (nextStock < 0) {
        throw new Error(INVENTORY_ERRORS.insufficientStock);
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
        supplierId: input.supplierId ?? null,
        refType: input.refType,
        refId: input.refId,
        note: input.note,
        createdAt,
      }) as Promise<number>;
    });
  }

  /**
   * Surtir / restock (stock path ≠ sale).
   * Increases stock + updates weighted avgCost (Math.round).
   * Records stockMoves reason=surtir + cashMoves kind=compra direction=out when totalCost > 0.
   *
   * Cost source of truth: reconcileSurtirCost — if unit×qty ≠ total, total wins
   * (cash out) and unitCost = round(total / qty).
   */
  async surtir(input: {
    productId: number;
    qty: number;
    unitCost: number;
    totalCost: number;
    method: PayMethod;
    supplierId?: number | null;
    note?: string;
    /** Default today; editable date from UI. */
    createdAt?: number;
  }): Promise<number> {
    if (!Number.isInteger(input.qty) || input.qty <= 0) {
      throw new Error(INVENTORY_ERRORS.notPositive);
    }
    if (input.method !== "Efectivo" && input.method !== "Nequi") {
      throw new Error(INVENTORY_ERRORS.noMethod);
    }
    const rawUnit = asCop(input.unitCost);
    const rawTotal = asCop(input.totalCost);
    if (rawUnit < 0 || rawTotal < 0) {
      throw new Error(INVENTORY_ERRORS.badCost);
    }
    const { unitCost, totalCost } = reconcileSurtirCost(
      input.qty,
      rawUnit,
      rawTotal,
    );

    const db = getDb();
    const createdAt = input.createdAt ?? Date.now();
    await assertDayEditable(createdAt);

    return db.transaction(
      "rw",
      db.products,
      db.stockMoves,
      db.cashMoves,
      db.suppliers,
      db.cashSessions,
      async () => {
        await assertDayEditable(createdAt);
        if (input.supplierId != null) {
          const supplier = await db.suppliers.get(input.supplierId);
          if (!supplier) throw new Error("supplier not found");
        }

        const product = await db.products.get(input.productId);
        if (!product) throw new Error("product not found");

        const nextAvg = weightedAvgCost(
          product.stock,
          product.avgCost,
          input.qty,
          unitCost,
        );
        const nextStock = product.stock + input.qty;
        if (nextStock < 0) {
          throw new Error(INVENTORY_ERRORS.insufficientStock);
        }

        await db.products.update(product.id!, {
          stock: nextStock,
          avgCost: nextAvg,
          updatedAt: Date.now(),
        });

        const moveId = (await db.stockMoves.add({
          productId: product.id!,
          delta: input.qty,
          reason: "surtir",
          unitCost,
          supplierId: input.supplierId ?? null,
          refType: "purchase",
          note: input.note,
          createdAt,
        })) as number;

        if (totalCost > 0) {
          const open = await db.cashSessions
            .filter((s) => s.closedAt == null)
            .first();
          await db.cashMoves.add({
            amount: totalCost,
            direction: "out",
            method: input.method,
            kind: "compra",
            refType: "stockMove",
            refId: moveId,
            sessionId: open?.id ?? null,
            note: input.note,
            createdAt,
          });
        }

        return moveId;
      },
    );
  }

  /**
   * Shrink / merma — decrease stock with NO sale and NO income / pay method.
   * Distinct reasons: me_lo_comi | regalar | perdido.
   */
  async applyShrink(input: {
    productId: number;
    qty: number;
    reason: ShrinkReason;
    note?: string;
  }): Promise<number> {
    if (!Number.isInteger(input.qty) || input.qty <= 0) {
      throw new Error(INVENTORY_ERRORS.notPositive);
    }
    return this.applyMove({
      productId: input.productId,
      delta: -input.qty,
      reason: input.reason,
      note: input.note,
      refType: "shrink",
    });
  }
}

export const inventoryRepository = new InventoryRepository();
