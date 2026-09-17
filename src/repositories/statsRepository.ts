import { addCop, mulCop, subCop } from "@/domain/money";
import {
  inRange,
  rangeForPeriod,
  type PeriodRange,
  type StatsPeriod,
} from "@/domain/stats";
import { getDb } from "@/storage/db";
import { customerRepository } from "./customerRepository";

/**
 * Period stats — each metric SEPARATE (never mix into one total).
 *
 * Formulas (Dexie-only, offline-safe):
 * - Ventas: sum(sale.saleTotal) in period (brutas; devoluciones aparte)
 * - Devoluciones: sum(qty × unitPrice) of return lines in period
 * - Recibido: sum(sale.amountReceived) + sum(customerPayments) in period
 *   Efectivo|Nequi via cashMoves kind sale|debt_collect
 * - Por cobrar: sum(customer.debt) outstanding (point-in-time)
 * - Gasté: sum(expenses.amount) in period — operativos only (≠ retiro)
 * - Invertí: sum(cashMoves kind=compra) in period — surtir/purchase cash out
 * - Valor inventario: sum(stock × avgCost) current
 * - Stock bajo: count stock ≤ lowStockAt
 * - Ganancia aprox: sale margins in period − returned margins whose return is in period
 *
 * Caja Esperado/Contado/Diferencia: NOT here — Stats only links «Ir a Caja».
 */

export type StatsSnapshot = {
  period: StatsPeriod;
  range: PeriodRange;
  ventas: number;
  ventasCount: number;
  devoluciones: number;
  devolucionesCount: number;
  recibido: number;
  recibidoEfectivo: number;
  recibidoNequi: number;
  porCobrar: number;
  gaste: number;
  inverti: number;
  ganancia: number;
  valorInventario: number;
  stockBajo: number;
  emptyPeriod: boolean;
};

export async function loadStats(
  period: StatsPeriod,
  nowMs: number = Date.now(),
): Promise<StatsSnapshot> {
  const range = rangeForPeriod(period, nowMs);
  const db = getDb();

  const [sales, payments, expenses, cashMoves, products, returns] =
    await Promise.all([
      db.sales.toArray(),
      db.customerPayments.toArray(),
      db.expenses.toArray(),
      db.cashMoves.toArray(),
      db.products.toArray(),
      db.saleReturns.toArray(),
    ]);

  const salesIn = sales.filter((s) => inRange(s.createdAt, range));
  const paymentsIn = payments.filter((p) => inRange(p.createdAt, range));
  const expensesIn = expenses.filter((e) => inRange(e.createdAt, range));
  const movesIn = cashMoves.filter((m) => inRange(m.createdAt, range));
  const returnsIn = returns.filter((r) => inRange(r.createdAt, range));

  const ventas = salesIn.reduce((a, s) => addCop(a, s.saleTotal), 0);
  const ventasCount = salesIn.length;

  const fromSales = salesIn.reduce((a, s) => addCop(a, s.amountReceived), 0);
  const fromAbonos = paymentsIn.reduce((a, p) => addCop(a, p.amount), 0);
  const recibido = addCop(fromSales, fromAbonos);

  let recibidoEfectivo = 0;
  let recibidoNequi = 0;
  for (const m of movesIn) {
    if (m.kind !== "sale" && m.kind !== "debt_collect") continue;
    if (m.direction !== "in") continue;
    if (m.method === "Efectivo") {
      recibidoEfectivo = addCop(recibidoEfectivo, m.amount);
    } else if (m.method === "Nequi") {
      recibidoNequi = addCop(recibidoNequi, m.amount);
    }
  }

  const porCobrar = await customerRepository.totalDebt();

  const saleIds = new Set(
    salesIn.map((s) => s.id).filter((id): id is number => id != null),
  );
  const lines = await db.saleLines.toArray();
  let ganancia = 0;
  for (const line of lines) {
    if (!saleIds.has(line.saleId)) continue;
    const cogs = mulCop(line.unitCost, line.qty);
    ganancia = addCop(ganancia, subCop(line.lineTotal, cogs));
  }

  const returnIds = new Set(
    returnsIn.map((r) => r.id).filter((id): id is number => id != null),
  );
  const returnLines = await db.saleReturnLines.toArray();
  let devoluciones = 0;
  for (const rl of returnLines) {
    if (!returnIds.has(rl.returnId)) continue;
    devoluciones = addCop(devoluciones, mulCop(rl.unitPrice, rl.qty));
    const margin = mulCop(subCop(rl.unitPrice, rl.unitCost), rl.qty);
    ganancia = subCop(ganancia, margin);
  }

  const gaste = expensesIn.reduce((a, e) => addCop(a, e.amount), 0);
  const inverti = movesIn
    .filter((m) => m.kind === "compra")
    .reduce((a, m) => addCop(a, m.amount), 0);

  let valorInventario = 0;
  let stockBajo = 0;
  for (const p of products) {
    valorInventario = addCop(valorInventario, mulCop(p.avgCost, p.stock));
    if (p.stock <= p.lowStockAt) stockBajo += 1;
  }

  const emptyPeriod =
    salesIn.length === 0 &&
    paymentsIn.length === 0 &&
    expensesIn.length === 0 &&
    movesIn.length === 0 &&
    returnsIn.length === 0;

  return {
    period,
    range,
    ventas,
    ventasCount,
    devoluciones,
    devolucionesCount: returnsIn.length,
    recibido,
    recibidoEfectivo,
    recibidoNequi,
    porCobrar,
    gaste,
    inverti,
    ganancia,
    valorInventario,
    stockBajo,
    emptyPeriod,
  };
}

export const statsRepository = { loadStats };
