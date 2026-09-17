import { getDb } from "@/storage/db";
import type { PayMethod, Product, StockMove, Supplier } from "@/domain/types";
import { formatCop } from "@/domain/money";
import { INVENTORY_ERRORS } from "@/domain/inventory";

export type SupplierSurtirHistoryItem = {
  id: string;
  stockMoveId: number;
  productId: number;
  productName: string;
  qty: number;
  unitCost: number;
  totalCost: number;
  method: PayMethod | null;
  createdAt: number;
  note?: string;
  label: string;
};

/**
 * Light suppliers — name / phone / notes + historial de surtidas.
 * NO accounts payable / CxP.
 */
export class SupplierRepository {
  async list(): Promise<Supplier[]> {
    return getDb().suppliers.orderBy("name").toArray();
  }

  async getById(id: number): Promise<Supplier | undefined> {
    return getDb().suppliers.get(id);
  }

  async search(query: string): Promise<Supplier[]> {
    const q = query.trim().toLowerCase();
    const all = await this.list();
    if (!q) return all;
    return all.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q),
    );
  }

  async create(input: {
    name: string;
    phone?: string;
    notes?: string;
  }): Promise<number> {
    const name = input.name?.trim() ?? "";
    if (!name) throw new Error(INVENTORY_ERRORS.emptySupplierName);
    const now = Date.now();
    const id = await getDb().suppliers.add({
      name,
      phone: input.phone?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    });
    return id as number;
  }

  async update(
    id: number,
    patch: Partial<Pick<Supplier, "name" | "phone" | "notes">>,
  ): Promise<void> {
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new Error(INVENTORY_ERRORS.emptySupplierName);
      patch = { ...patch, name };
    }
    await getDb().suppliers.update(id, { ...patch, updatedAt: Date.now() });
  }

  /**
   * Historial de surtidas for a supplier (NO CxP / no saldo).
   * Newest first.
   */
  async listSurtidas(
    supplierId: number,
    limit = 50,
  ): Promise<SupplierSurtirHistoryItem[]> {
    const db = getDb();
    const moves = await db.stockMoves
      .filter(
        (m) =>
          m.reason === "surtir" &&
          m.supplierId === supplierId &&
          m.delta > 0,
      )
      .toArray();
    moves.sort((a, b) => b.createdAt - a.createdAt);

    const productCache = new Map<number, Product | undefined>();
    const allCash = await db.cashMoves.toArray();
    const cashByMoveId = new Map(
      allCash
        .filter((c) => c.refType === "stockMove" && c.kind === "compra")
        .map((c) => [c.refId, c] as const),
    );
    const items: SupplierSurtirHistoryItem[] = [];

    for (const m of moves.slice(0, limit)) {
      if (!productCache.has(m.productId)) {
        productCache.set(m.productId, await db.products.get(m.productId));
      }
      const product = productCache.get(m.productId);
      const productName = product?.name ?? `Producto #${m.productId}`;
      const qty = m.delta;
      const totalCost = m.unitCost * qty;
      const cash = cashByMoveId.get(m.id);
      const method = (cash?.method as PayMethod | undefined) ?? null;
      const amount = cash?.amount ?? totalCost;

      items.push({
        id: `surtir-${m.id}`,
        stockMoveId: m.id!,
        productId: m.productId,
        productName,
        qty,
        unitCost: m.unitCost,
        totalCost: amount,
        method,
        createdAt: m.createdAt,
        note: m.note,
        label: `${productName} · ×${qty} · ${formatCop(amount)}${
          method ? ` · ${method}` : ""
        }`,
      });
    }

    return items;
  }

  /** Find-or-create by exact trimmed name (Surtir pick/create light). */
  async findOrCreateByName(name: string): Promise<number> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error(INVENTORY_ERRORS.emptySupplierName);
    const all = await this.list();
    const existing = all.find(
      (s) => s.name.toLowerCase() === trimmed.toLowerCase(),
    );
    if (existing?.id != null) return existing.id;
    return this.create({ name: trimmed });
  }
}

export const supplierRepository = new SupplierRepository();

/** Re-export for callers that list moves typed. */
export type { StockMove };
