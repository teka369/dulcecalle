import { getDb } from "@/storage/db";
import type { Product } from "@/domain/types";
import { asCop } from "@/domain/money";
import { INVENTORY_ERRORS } from "@/domain/inventory";

export class ProductRepository {
  async list(): Promise<Product[]> {
    const db = getDb();
    return db.products.orderBy("name").toArray();
  }

  async getById(id: number): Promise<Product | undefined> {
    return getDb().products.get(id);
  }

  async search(query: string): Promise<Product[]> {
    const q = query.trim().toLowerCase();
    const all = await this.list();
    if (!q) return all;
    return all.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q),
    );
  }

  async categories(): Promise<string[]> {
    const all = await this.list();
    return Array.from(new Set(all.map((p) => p.category))).sort();
  }

  async create(
    input: Omit<Product, "id" | "createdAt" | "updatedAt">,
  ): Promise<number> {
    const now = Date.now();
    asCop(input.price);
    asCop(input.avgCost);
    if (input.price < 0 || input.avgCost < 0) {
      throw new Error(INVENTORY_ERRORS.badCost);
    }
    if (input.stock < 0) throw new Error("stock must be ≥ 0");
    const db = getDb();
    return db.transaction("rw", db.products, db.stockMoves, async () => {
      const id = (await db.products.add({
        ...input,
        createdAt: now,
        updatedAt: now,
      })) as number;

      // Birth snapshot: not a compra, not a day's cash event.
      // Existing products created before v5 keep stock without this move.
      if (input.stock > 0) {
        await db.stockMoves.add({
          productId: id,
          delta: input.stock,
          reason: "inicial",
          unitCost: asCop(input.avgCost),
          refType: "product",
          refId: id,
          createdAt: now,
        });
      }

      return id;
    });
  }

  async update(
    id: number,
    patch: Partial<Omit<Product, "id" | "createdAt">>,
  ): Promise<void> {
    if (patch.stock !== undefined) {
      throw new Error(INVENTORY_ERRORS.stockViaMoves);
    }
    if (patch.price !== undefined) {
      asCop(patch.price);
      if (patch.price < 0) throw new Error(INVENTORY_ERRORS.badCost);
    }
    if (patch.avgCost !== undefined) {
      asCop(patch.avgCost);
      if (patch.avgCost < 0) throw new Error(INVENTORY_ERRORS.badCost);
    }
    await getDb().products.update(id, { ...patch, updatedAt: Date.now() });
  }

  async lowStock(): Promise<Product[]> {
    const all = await this.list();
    return all.filter((p) => p.stock <= p.lowStockAt);
  }
}

export const productRepository = new ProductRepository();
