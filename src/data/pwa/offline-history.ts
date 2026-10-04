/**
 * Offline history v1. Server remains the authority. Dexie stores the
 * prepared window plus pending outbox rows. No delta sync: the current
 * API has no updatedSince. A repeat preparation upserts by id.
 *
 * Windows: sales and stock moves 90 days, cash moves and expenses 30 days,
 * cash session today, ledgers for customers with debt or a sale in the
 * sales window. Two offline abonos on two phones can still conflict on
 * the server (debt >= amount). That is not resolved here.
 */
import { getPwaApi } from "./api";
import { persistServerSale } from "./offline-returns";
import { pendingDebtAdjustment } from "./pending-debt";
import { getLocalDb } from "../local/db";
import { customerToLocal } from "../local/read-cache";
import { mapCustomer, mapInitialDebt, mapPayment, mapReturn, mapSale } from "../http/mappers";
import type {
  LocalCashMove,
  LocalCashSession,
  LocalCustomerPayment,
  LocalExpense,
  LocalInitialDebt,
  LocalPreparation,
  LocalStockMove,
} from "../local/types";
import { addCop } from "@/domain/money";

export const SALES_WINDOW_DAYS = 90;
export const CASH_WINDOW_DAYS = 30;
export const MOVES_WINDOW_DAYS = 90;
export const HISTORY_FETCH_LIMIT = 4;

export const HISTORY_RESOURCES = [
  "history:sales",
  "history:ledgers",
  "history:cash",
  "history:moves",
] as const;

export type HistoryResource = (typeof HISTORY_RESOURCES)[number];

export function windowStart(days: number, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - days);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function todayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Bounded parallelism. Never fires the whole catalog at once. */
export async function mapPool<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const size = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item === undefined) return;
        await run(item);
      }
    }),
  );
}

async function protectedIds(businessId: string): Promise<Set<string>> {
  const ops = await getLocalDb().outbox.where("businessId").equals(businessId).toArray();
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.status === "synced") continue;
    ids.add(op.operationId);
    ids.add(op.requestId);
    if (op.remoteId) ids.add(op.remoteId);
  }
  return ids;
}

function blocked(ids: Set<string>, ...keys: Array<string | null | undefined>): boolean {
  return keys.some((key) => Boolean(key) && ids.has(key as string));
}

async function markHistory(businessId: string, resource: HistoryResource): Promise<void> {
  const db = getLocalDb();
  await db.cacheMeta.put({
    id: `${businessId}::${resource}`,
    businessId,
    resource,
    cachedAt: Date.now(),
  });
}

export async function historyReady(businessId: string, resource: HistoryResource): Promise<boolean> {
  const row = await getLocalDb().cacheMeta.get(`${businessId}::${resource}`);
  return Boolean(row);
}

export async function warmSalesHistory(businessId: string): Promise<string> {
  const from = windowStart(SALES_WINDOW_DAYS);
  const to = todayKey();
  const sales = await getPwaApi().sales.list(from, to);
  const guard = await protectedIds(businessId);
  await mapPool(sales, HISTORY_FETCH_LIMIT, async (sale) => {
    if (blocked(guard, sale.id)) return;
    const returns = await getPwaApi().sales.returns(sale.id);
    await persistServerSale(businessId, sale, returns);
  });
  await markHistory(businessId, "history:sales");
  return `${sales.length} ventas · ${from}`;
}

export async function warmLedgerHistory(businessId: string): Promise<string> {
  const db = getLocalDb();
  const from = windowStart(SALES_WINDOW_DAYS);
  const customers = await db.customers.where("businessId").equals(businessId).toArray();
  const sales = await db.sales.where("businessId").equals(businessId).toArray();
  const wanted = new Set<string>();
  for (const customer of customers) {
    if (customer.debt > 0) wanted.add(customer.id);
  }
  for (const sale of sales) {
    if (sale.customerId && sale.occurredOn >= from) wanted.add(sale.customerId);
  }
  const guard = await protectedIds(businessId);
  await mapPool([...wanted], HISTORY_FETCH_LIMIT, async (customerId) => {
    const ledger = await getPwaApi().customers.ledger(customerId);
    const customer = customerToLocal(mapCustomer(ledger.customer), businessId, Date.now());
    const pending = await pendingDebtAdjustment(businessId, customerId);
    if (!blocked(guard, customer.id, customer.requestId)) {
      await db.customers.put({ ...customer, debt: addCop(customer.debt, pending) });
    }
    for (const raw of ledger.initials) {
      const debt = mapInitialDebt(raw);
      if (blocked(guard, debt.id)) continue;
      const row: LocalInitialDebt = {
        id: debt.id,
        businessId,
        customerId,
        amount: debt.amount,
        note: debt.note,
        requestId: debt.id,
        occurredOn: debt.occurredOn,
        createdAt: debt.createdAt,
      };
      await db.initialDebts.put(row);
    }
    for (const raw of ledger.sales) {
      const sale = mapSale(raw);
      if (blocked(guard, sale.id)) continue;
      const returns = Array.isArray(raw.returns) ? raw.returns.map((row) => mapReturn(row)) : [];
      await persistServerSale(businessId, sale, returns);
    }
    for (const raw of ledger.payments) {
      const payment = mapPayment(raw);
      if (blocked(guard, payment.id)) continue;
      const row: LocalCustomerPayment = {
        id: payment.id,
        businessId,
        customerId,
        amount: payment.amount,
        method: payment.method === "Nequi" ? "Nequi" : "Efectivo",
        saleId: null,
        requestId: payment.id,
        note: payment.note,
        occurredOn: payment.occurredOn,
        createdAt: payment.createdAt,
      };
      await db.customerPayments.put(row);
    }
  });
  await markHistory(businessId, "history:ledgers");
  return `${wanted.size} fiados`;
}

export async function warmCashHistory(businessId: string): Promise<string> {
  const api = getPwaApi();
  const from = windowStart(CASH_WINDOW_DAYS);
  const to = todayKey();
  const [today, moves, expenses] = await Promise.all([
    api.cash.today(),
    api.cash.moves(undefined, from, to),
    api.cash.expenses(from, to),
  ]);
  const db = getLocalDb();
  const guard = await protectedIds(businessId);
  if (today.session && !blocked(guard, today.session.id, today.session.id)) {
    const session: LocalCashSession = {
      id: today.session.id,
      businessId,
      localDate: today.session.localDate,
      openedAt: today.session.openedAt,
      closedAt: today.session.closedAt,
      openingFloat: today.session.openingFloat,
      closingCount: today.session.closingCount,
      expectedEfectivo: today.session.expectedEfectivo,
      expectedNequi: today.session.expectedNequi,
      difference: today.session.difference,
      note: null,
      createdAt: today.session.openedAt,
      updatedAt: Date.now(),
    };
    await db.cashSessions.put(session);
  }
  for (const move of [...today.moves, ...moves]) {
    if (blocked(guard, move.id)) continue;
    const row: LocalCashMove = {
      id: move.id,
      businessId,
      amount: move.amount,
      direction: move.direction === "out" ? "out" : "in",
      method: move.method === "Nequi" ? "Nequi" : "Efectivo",
      kind: move.kind,
      sessionId: today.session?.id ?? null,
      refType: move.refType,
      refId: move.refId,
      requestId: null,
      note: null,
      occurredOn: move.occurredOn,
      createdAt: move.createdAt,
    };
    await db.cashMoves.put(row);
  }
  for (const expense of expenses) {
    if (blocked(guard, expense.id)) continue;
    const row: LocalExpense = {
      id: expense.id,
      businessId,
      amount: expense.amount,
      category: expense.category,
      note: expense.note,
      method: expense.method === "Nequi" ? "Nequi" : "Efectivo",
      requestId: expense.id,
      occurredOn: expense.occurredOn,
      createdAt: expense.createdAt,
    };
    await db.expenses.put(row);
  }
  await markHistory(businessId, "history:cash");
  return `caja ${today.localDate} · ${expenses.length} gastos`;
}

export async function warmMoveHistory(businessId: string): Promise<string> {
  const db = getLocalDb();
  const from = windowStart(MOVES_WINDOW_DAYS);
  const products = await db.products.where("businessId").equals(businessId).toArray();
  const guard = await protectedIds(businessId);
  let kept = 0;
  await mapPool(products, HISTORY_FETCH_LIMIT, async (product) => {
    const moves = await getPwaApi().inventory.moves(product.id);
    for (const move of moves) {
      if (move.occurredOn < from || blocked(guard, move.id)) continue;
      const row: LocalStockMove = {
        id: move.id,
        businessId,
        productId: move.productId,
        delta: move.delta,
        reason: move.reason,
        unitCost: move.unitCost,
        supplierId: move.supplierId,
        refType: null,
        refId: null,
        note: move.note,
        requestId: null,
        occurredOn: move.occurredOn,
        createdAt: move.createdAt,
      };
      await db.stockMoves.put(row);
      kept += 1;
    }
  });
  const preparations = await getPwaApi().production.list();
  for (const prep of preparations) {
    if (prep.occurredOn < from || blocked(guard, prep.id, prep.id)) continue;
    const row: LocalPreparation = {
      id: prep.id,
      businessId,
      sourceId: prep.sourceId,
      sourceName: prep.sourceName,
      targetId: prep.targetId,
      targetName: prep.targetName,
      qty: prep.qty,
      unitCost: prep.unitCost,
      note: prep.note,
      occurredOn: prep.occurredOn,
      createdAt: prep.createdAt,
    };
    await db.preparations.put(row);
  }
  await markHistory(businessId, "history:moves");
  return `${kept} movimientos · ${preparations.length} preparaciones`;
}
