import { getDb } from "@/storage/db";
import { isDbEmpty } from "@/storage/seed";
import {
  buildDashboardSnapshot,
  type DashboardSnapshot,
} from "@/domain/dashboard/snapshot";
import { cashRepository } from "./cashRepository";

export async function loadDashboard(): Promise<DashboardSnapshot> {
  const db = getDb();
  const [
    sales,
    customers,
    products,
    payments,
    returns,
    initials,
    stockMoves,
    day,
    emptyDb,
    business,
  ] = await Promise.all([
    db.sales.toArray(),
    db.customers.toArray(),
    db.products.toArray(),
    db.customerPayments.toArray(),
    db.saleReturns.toArray(),
    db.initialDebts.toArray(),
    db.stockMoves.toArray(),
    cashRepository.daySummary(),
    isDbEmpty(),
    db.settings.get("businessName"),
  ]);

  return buildDashboardSnapshot({
    sales,
    customers,
    products,
    payments,
    returns,
    initials,
    stockMoves,
    session: day.session,
    cajaExpectedEfectivo: day.session ? day.expected.efectivo : null,
    emptyDb,
    businessName: business?.value ?? null,
  });
}
