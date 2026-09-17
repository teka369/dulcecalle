import { getDb } from "@/storage/db";
import type { Product } from "@/domain/types";
import { asCop } from "@/domain/money";

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
    if (input.stock < 0) throw new Error("stock must be ≥ 0");
    const id = await getDb().products.add({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    return id as number;
  }

  async update(
    id: number,
    patch: Partial<Omit<Product, "id" | "createdAt">>,
  ): Promise<void> {
    if (patch.price !== undefined) asCop(patch.price);
    if (patch.avgCost !== undefined) asCop(patch.avgCost);
    if (patch.stock !== undefined && patch.stock < 0) {
      throw new Error("stock must be ≥ 0");
    }
    await getDb().products.update(id, { ...patch, updatedAt: Date.now() });
  }

  async lowStock(): Promise<Product[]> {
    const all = await this.list();
    return all.filter((p) => p.stock <= p.lowStockAt);
  }
}

export const productRepository = new ProductRepository();
