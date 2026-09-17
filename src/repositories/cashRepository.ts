import { getDb } from "@/storage/db";
import type { CashMove, CashSession, Expense, PayMethod } from "@/domain/types";
import { asCop, addCop, subCop } from "@/domain/money";
import {
  CASH_ERRORS,
  endOfLocalDay,
  localDateKey,
  startOfLocalDay,
} from "@/domain/cash";
import { inventoryRepository } from "./inventoryRepository";
import { assertDayEditable } from "./dayGuard";

export type ExpectedBuckets = {
  efectivo: number;
  nequi: number;
  /** Efectivo + Nequi expected (display total; close count uses efectivo only). */
  total: number;
};

export type DayCashSummary = {
  localDate: string;
  session: CashSession | null;
  expected: ExpectedBuckets;
  counted: number | null;
  difference: number | null;
  closed: boolean;
  moves: CashMove[];
  entradas: number;
  salidas: number;
};

/**
 * Caja / gasto / retiro / aporte — NEVER conflate with VENTAS, FIADO, STOCK.
 * Close physical count = Efectivo only; Nequi tracked separately.
 *
 * Two different numbers (do not mix):
 *
 * 1. balance()
 *    Σ cashMoves (all time, all methods). in adds, out subtracts.
 *    Does NOT include CashSession.openingFloat — that is not a cashMove.
 *
 * 2. expectedBuckets(day).efectivo  ("Caja esperado")
 *    session.openingFloat + Σ that day's Efectivo cashMoves.
 *    Nequi starts at 0 (opening float is physical cash).
 */
export class CashRepository {
  async listMoves(): Promise<CashMove[]> {
    return getDb().cashMoves.orderBy("createdAt").toArray();
  }

  async listExpenses(): Promise<Expense[]> {
    return getDb().expenses.orderBy("createdAt").reverse().toArray();
  }

  /**
   * Ledger of cashMoves only. openingFloat is NOT included.
   * For "what should be in the till today" use expectedBuckets().
   */
  async balance(): Promise<number> {
    const moves = await this.listMoves();
    return moves.reduce((sum, m) => {
      return m.direction === "in" ? addCop(sum, m.amount) : subCop(sum, m.amount);
    }, 0);
  }

  async listMovesForLocalDate(localDate: string): Promise<CashMove[]> {
    const start = startOfLocalDay(
      new Date(
        Number(localDate.slice(0, 4)),
        Number(localDate.slice(5, 7)) - 1,
        Number(localDate.slice(8, 10)),
      ).getTime(),
    );
    const end = endOfLocalDay(start);
    const moves = await this.listMoves();
    return moves.filter((m) => m.createdAt >= start && m.createdAt <= end);
  }

  async getSessionByLocalDate(localDate: string): Promise<CashSession | undefined> {
    const all = await getDb().cashSessions.toArray();
    return all.find((s) => s.localDate === localDate);
  }

  async getTodaySession(): Promise<CashSession | undefined> {
    return this.getSessionByLocalDate(localDateKey());
  }

  async getOpenSession(): Promise<CashSession | undefined> {
    const today = await this.getTodaySession();
    if (today && today.closedAt == null) return today;
    const all = await getDb().cashSessions.filter((s) => s.closedAt == null).toArray();
    return all[0];
  }

  /** Reject mutations when the target day's session is closed. */
  async assertTodayEditable(): Promise<CashSession | null> {
    await assertDayEditable();
    const session = await this.getTodaySession();
    return session ?? null;
  }

  /**
   * Expected buckets for a local day.
   * Efectivo starts at openingFloat; then +/- cashMoves that day by method.
   * Nequi does NOT include opening float (physical open is cash).
   */
  async expectedBuckets(localDate: string = localDateKey()): Promise<ExpectedBuckets> {
    const session = await this.getSessionByLocalDate(localDate);
    const opening = session ? asCop(session.openingFloat) : 0;
    let efectivo = opening;
    let nequi = 0;

    const moves = await this.listMovesForLocalDate(localDate);
    for (const m of moves) {
      const delta = m.direction === "in" ? m.amount : -m.amount;
      if (m.method === "Efectivo") {
        efectivo = addCop(efectivo, delta);
      } else if (m.method === "Nequi") {
        nequi = addCop(nequi, delta);
      }
    }

    return {
      efectivo,
      nequi,
      total: addCop(efectivo, nequi),
    };
  }

  async daySummary(localDate: string = localDateKey()): Promise<DayCashSummary> {
    const session = (await this.getSessionByLocalDate(localDate)) ?? null;
    const expected = await this.expectedBuckets(localDate);
    const moves = await this.listMovesForLocalDate(localDate);
    let entradas = 0;
    let salidas = 0;
    for (const m of moves) {
      if (m.direction === "in") entradas = addCop(entradas, m.amount);
      else salidas = addCop(salidas, m.amount);
    }
    const closed = session?.closedAt != null;
    const counted =
      session?.closingCount != null ? session.closingCount : null;
    const difference =
      counted != null ? subCop(counted, expected.efectivo) : session?.difference ?? null;

    return {
      localDate,
      session,
      expected,
      counted,
      difference,
      closed,
      moves,
      entradas,
      salidas,
    };
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
    createdAt?: number;
    /** When true, skip closed-day check (internal/tests only). */
    _skipClosedCheck?: boolean;
  }): Promise<number> {
    const amount = asCop(input.amount);
    if (amount <= 0) throw new Error("cash move amount must be > 0");
    if (input.method !== "Efectivo" && input.method !== "Nequi") {
      throw new Error(CASH_ERRORS.noMethod);
    }

    const createdAt = input.createdAt ?? Date.now();
    if (!input._skipClosedCheck) {
      await assertDayEditable(createdAt);
    }

    let sessionId = input.sessionId;
    if (sessionId === undefined) {
      const open = await this.getOpenSession();
      sessionId = open?.id ?? null;
    }

    return getDb().cashMoves.add({
      amount,
      direction: input.direction,
      method: input.method,
      kind: input.kind,
      refType: input.refType,
      refId: input.refId,
      sessionId: sessionId ?? null,
      note: input.note,
      createdAt,
    }) as Promise<number>;
  }

  /** Owner aporte (cash in) — owner_in. NOT a sale. Does NOT touch stock. */
  async ownerAporte(
    amount: number,
    method: PayMethod = "Efectivo",
    note?: string,
  ): Promise<number> {
    return this.recordMove({
      amount,
      direction: "in",
      method,
      kind: "aporte",
      note,
    });
  }

  /** Owner retiro (cash out) — owner_out. NOT an expense. Does NOT touch stock. */
  async ownerRetiro(
    amount: number,
    method: PayMethod = "Efectivo",
    note?: string,
  ): Promise<number> {
    return this.recordMove({
      amount,
      direction: "out",
      method,
      kind: "retiro",
      note,
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

  /**
   * Gasto operativo — business cost. NOT retiro. Does NOT touch stock.
   */
  async recordExpense(input: {
    amount: number;
    category: string;
    note?: string;
    method?: PayMethod;
  }): Promise<number> {
    const amount = asCop(input.amount);
    if (amount <= 0) throw new Error("expense amount must be > 0");
    const method = input.method ?? "Efectivo";
    if (method !== "Efectivo" && method !== "Nequi") {
      throw new Error(CASH_ERRORS.noMethod);
    }
    const category = input.category.trim();
    if (!category) throw new Error(CASH_ERRORS.emptyCategory);

    await assertDayEditable();

    const db = getDb();
    const open = await this.getOpenSession();

    return db.transaction("rw", db.expenses, db.cashMoves, db.cashSessions, async () => {
      await assertDayEditable();
      const expenseId = (await db.expenses.add({
        amount,
        category,
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
        sessionId: open?.id ?? null,
        note: category,
        createdAt: Date.now(),
      });

      return expenseId;
    });
  }

  /**
   * Open today's cash session (1 per local calendar day).
   * openingFloat is Efectivo; must be ≥ 0.
   */
  async openSession(openingFloat = 0): Promise<number> {
    const float = asCop(openingFloat);
    if (float < 0) throw new Error(CASH_ERRORS.openingNegative);

    const localDate = localDateKey();
    const existing = await this.getSessionByLocalDate(localDate);
    if (existing) {
      if (existing.closedAt != null) {
        throw new Error(CASH_ERRORS.dayClosedAlt);
      }
      throw new Error(CASH_ERRORS.sessionAlreadyOpen);
    }

    return getDb().cashSessions.add({
      localDate,
      openedAt: Date.now(),
      closedAt: null,
      openingFloat: float,
      closingCount: null,
      expectedEfectivo: null,
      expectedNequi: null,
      difference: null,
    }) as Promise<number>;
  }

  /**
   * Close session: counted = physical Efectivo only.
   * difference = counted − expectedEfectivo. Nequi expected stored but not counted.
   */
  async closeSession(sessionId: number, closingCount: number): Promise<void> {
    const counted = asCop(closingCount);
    if (counted < 0) throw new Error(CASH_ERRORS.badCounted);

    const db = getDb();
    const session = await db.cashSessions.get(sessionId);
    if (!session) throw new Error("session not found");
    if (session.closedAt != null) throw new Error(CASH_ERRORS.sessionAlreadyClosed);

    const expected = await this.expectedBuckets(session.localDate);
    const difference = subCop(counted, expected.efectivo);

    await db.cashSessions.update(sessionId, {
      closedAt: Date.now(),
      closingCount: counted,
      expectedEfectivo: expected.efectivo,
      expectedNequi: expected.nequi,
      difference,
    });
  }

  /** Close today's open session with physical Efectivo count. */
  async closeToday(countedEfectivo: number): Promise<void> {
    const session = await this.getTodaySession();
    if (!session || session.id == null) {
      throw new Error(CASH_ERRORS.noOpenSession);
    }
    if (session.closedAt != null) {
      throw new Error(CASH_ERRORS.sessionAlreadyClosed);
    }
    await this.closeSession(session.id, countedEfectivo);
  }
}

export const cashRepository = new CashRepository();
