import { getDb } from "@/storage/db";
import type { CashMove, CashSession, PayMethod } from "@/domain/types";
import { asCop, addCop, subCop } from "@/domain/money";
import { inventoryRepository } from "./inventoryRepository";

export class CashRepository {
  async listMoves(): Promise<CashMove[]> {
    return getDb().cashMoves.orderBy("createdAt").toArray();
  }

  /**
   * Caja balance from cashMoves only (CAJA ≠ VENTAS ≠ FIADO).
   * in adds, out subtracts.
   */
  async balance(): Promise<number> {
    const moves = await this.listMoves();
    return moves.reduce((sum, m) => {
      return m.direction === "in" ? addCop(sum, m.amount) : subCop(sum, m.amount);
    }, 0);
  }

  async recordMove(input: {
    amount: number;
    direction: "in" | "out";
    method: PayMethod;
    kind: string;
    refType?: string;
    refId?: number;
    note?: string;
    sessionId?: number | null;
  }): Promise<number> {
    const amount = asCop(input.amount);
    if (amount <= 0) throw new Error("cash move amount must be > 0");
    return getDb().cashMoves.add({
      amount,
      direction: input.direction,
      method: input.method,
      kind: input.kind,
      refType: input.refType,
      refId: input.refId,
      sessionId: input.sessionId ?? null,
      note: input.note,
      createdAt: Date.now(),
    }) as Promise<number>;
  }

  /** Owner aporte (cash in). */
  async ownerAporte(amount: number, method: PayMethod = "Efectivo"): Promise<number> {
    return this.recordMove({
      amount,
      direction: "in",
      method,
      kind: "aporte",
    });
  }

  /** Owner retiro (cash out). */
  async ownerRetiro(amount: number, method: PayMethod = "Efectivo"): Promise<number> {
    return this.recordMove({
      amount,
      direction: "out",
      method,
      kind: "retiro",
    });
  }

  /**
   * Purchase / surtir stock + cash out for compra.
   * Delegates to inventoryRepository.surtir (stock path; NOT sale).
   * Updates weighted avgCost via Math.round; stock never negative.
   */
  async purchaseStock(input: {
    productId: number;
    qty: number;
    totalCost: number;
    method?: PayMethod;
    unitCost?: number;
    supplierId?: number | null;
    note?: string;
    createdAt?: number;
  }): Promise<void> {
    if (!Number.isInteger(input.qty) || input.qty <= 0) {
      throw new Error("qty must be a positive integer");
    }
    const totalCost = asCop(input.totalCost);
    const unitCost =
      input.unitCost !== undefined
        ? asCop(input.unitCost)
        : asCop(Math.round(totalCost / input.qty));
    const method = input.method ?? "Efectivo";

    await inventoryRepository.surtir({
      productId: input.productId,
      qty: input.qty,
      unitCost,
      totalCost,
      method,
      supplierId: input.supplierId ?? null,
      note: input.note,
      createdAt: input.createdAt,
    });
  }

  async recordExpense(input: {
    amount: number;
    category: string;
    note?: string;
    method?: PayMethod;
  }): Promise<number> {
    const amount = asCop(input.amount);
    if (amount <= 0) throw new Error("expense amount must be > 0");
    const method = input.method ?? "Efectivo";
    const db = getDb();

    return db.transaction("rw", db.expenses, db.cashMoves, async () => {
      const expenseId = (await db.expenses.add({
        amount,
        category: input.category,
        note: input.note,
        method,
        createdAt: Date.now(),
      })) as number;

      await db.cashMoves.add({
        amount,
        direction: "out",
        method,
        kind: "expense",
        refType: "expense",
        refId: expenseId,
        sessionId: null,
        note: input.category,
        createdAt: Date.now(),
      });

      return expenseId;
    });
  }

  async openSession(openingFloat = 0): Promise<number> {
    asCop(openingFloat);
    return getDb().cashSessions.add({
      openedAt: Date.now(),
      closedAt: null,
      openingFloat,
      closingCount: null,
    }) as Promise<number>;
  }

  async closeSession(sessionId: number, closingCount: number): Promise<void> {
    asCop(closingCount);
    const db = getDb();
    const session = await db.cashSessions.get(sessionId);
    if (!session) throw new Error("session not found");
    if (session.closedAt != null) throw new Error("session already closed");
    await db.cashSessions.update(sessionId, {
      closedAt: Date.now(),
      closingCount,
    });
  }

  async getOpenSession(): Promise<CashSession | undefined> {
    const all = await getDb().cashSessions.filter((s) => s.closedAt == null).toArray();
    return all[0];
  }
}

export const cashRepository = new CashRepository();
