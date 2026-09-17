import { addCop } from "@/domain/money";
import { getDb } from "@/storage/db";
import { cashRepository } from "./cashRepository";
import { customerRepository } from "./customerRepository";
import { saleRepository } from "./saleRepository";

/**
 * Separate Day-1 metrics — NEVER blend into one number.
 *
 * - Ventas: sum of sale.saleTotal
 * - Recibido: sale.amountReceived sums + customer abonos (customerPayments)
 * - Fiado: sum of customer.debt (outstanding)
 * - Caja: cashMoves balance
 * - Stock: sum of product.stock (or per-product)
 */
export async function metricVentas(): Promise<number> {
  return saleRepository.sumSaleTotals();
}

export async function metricRecibido(): Promise<number> {
  const db = getDb();
  const sales = await db.sales.toArray();
  const fromSales = sales.reduce((s, sale) => addCop(s, sale.amountReceived), 0);
  const payments = await db.customerPayments.toArray();
  const fromAbonos = payments.reduce((s, p) => addCop(s, p.amount), 0);
  return addCop(fromSales, fromAbonos);
}

export async function metricFiadoOutstanding(): Promise<number> {
  return customerRepository.totalDebt();
}

export async function metricCaja(): Promise<number> {
  return cashRepository.balance();
}

export async function metricStockTotal(): Promise<number> {
  const products = await getDb().products.toArray();
  return products.reduce((s, p) => s + p.stock, 0);
}

export async function metricStockByProduct(productId: number): Promise<number> {
  const p = await getDb().products.get(productId);
  return p?.stock ?? 0;
}
