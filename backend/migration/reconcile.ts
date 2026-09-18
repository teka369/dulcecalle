import type { PrismaClient } from "@prisma/client";
import type { DexieDump, ImportWarning } from "./types";

export type ReconcileReport = {
  counts: Record<string, { dexie: number; pg: number; ok: boolean }>;
  amounts: {
    salesTotal: number;
    creditSales: number;
    paymentsTotal: number;
    initialDebtTotal: number;
    expensesTotal: number;
    cashInEfectivo: number;
    cashOutEfectivo: number;
    nequiIn: number;
    nequiOut: number;
  };
  balances: {
    customerDebt: number;
    reconstructedDebt: number;
    debtOk: boolean;
    cashExpectedEfectivo: number;
    nequiExpected: number;
  };
  stock: Array<{
    name: string;
    stock: number;
    sumDelta: number | null;
    inicial: boolean;
    warning?: string;
  }>;
  orphans: number;
  warnings: ImportWarning[];
  ok: boolean;
};

function n(v: bigint): number {
  return Number(v);
}

export async function reconcileImport(
  prisma: PrismaClient,
  dump: DexieDump,
  businessId: string,
  extraWarnings: ImportWarning[] = [],
): Promise<ReconcileReport> {
  const warnings = [...extraWarnings];
  const [
    products,
    customers,
    suppliers,
    sales,
    lines,
    returns,
    returnLines,
    moves,
    sessions,
    cashMoves,
    payments,
    initials,
    expenses,
  ] = await Promise.all([
    prisma.product.findMany({ where: { businessId } }),
    prisma.customer.findMany({ where: { businessId } }),
    prisma.supplier.findMany({ where: { businessId } }),
    prisma.sale.findMany({ where: { businessId } }),
    prisma.saleLine.findMany({ where: { businessId } }),
    prisma.saleReturn.findMany({ where: { businessId } }),
    prisma.saleReturnLine.findMany({ where: { businessId } }),
    prisma.stockMove.findMany({ where: { businessId } }),
    prisma.cashSession.findMany({ where: { businessId } }),
    prisma.cashMove.findMany({ where: { businessId } }),
    prisma.customerPayment.findMany({ where: { businessId } }),
    prisma.initialDebt.findMany({ where: { businessId } }),
    prisma.expense.findMany({ where: { businessId } }),
  ]);

  const pair = (dexie: number, pg: number) => ({
    dexie,
    pg,
    ok: dexie === pg,
  });

  const counts = {
    products: pair(dump.tables.products.length, products.length),
    customers: pair(dump.tables.customers.length, customers.length),
    suppliers: pair(dump.tables.suppliers.length, suppliers.length),
    sales: pair(dump.tables.sales.length, sales.length),
    saleLines: pair(dump.tables.saleLines.length, lines.length),
    returns: pair(dump.tables.saleReturns.length, returns.length),
    returnLines: pair(dump.tables.saleReturnLines.length, returnLines.length),
    stockMoves: pair(dump.tables.stockMoves.length, moves.length),
    cashSessions: pair(dump.tables.cashSessions.length, sessions.length),
    cashMoves: pair(dump.tables.cashMoves.length, cashMoves.length),
    payments: pair(dump.tables.customerPayments.length, payments.length),
    initialDebts: pair(dump.tables.initialDebts.length, initials.length),
    expenses: pair(dump.tables.expenses.length, expenses.length),
  };

  const salesTotal = sales.reduce((s, x) => s + n(x.saleTotal), 0);
  const creditSales = sales.reduce((s, x) => s + n(x.credit), 0);
  const paymentsTotal = payments.reduce((s, x) => s + n(x.amount), 0);
  const initialDebtTotal = initials.reduce((s, x) => s + n(x.amount), 0);
  const expensesTotal = expenses.reduce((s, x) => s + n(x.amount), 0);

  let cashInEfectivo = 0;
  let cashOutEfectivo = 0;
  let nequiIn = 0;
  let nequiOut = 0;
  for (const m of cashMoves) {
    const amt = n(m.amount);
    if (m.method === "Efectivo") {
      if (m.direction === "in") cashInEfectivo += amt;
      else cashOutEfectivo += amt;
    } else {
      if (m.direction === "in") nequiIn += amt;
      else nequiOut += amt;
    }
  }

  const opening = sessions.reduce((s, x) => s + n(x.openingFloat), 0);
  const cashExpectedEfectivo = opening + cashInEfectivo - cashOutEfectivo;
  const nequiExpected = nequiIn - nequiOut;

  const customerDebt = customers.reduce((s, x) => s + n(x.debt), 0);
  const reconstructedDebt =
    initialDebtTotal +
    creditSales -
    paymentsTotal -
    returns.reduce((s, x) => s + n(x.debtReduced), 0);
  const debtOk = reconstructedDebt === customerDebt;
  if (!debtOk) {
    warnings.push({
      code: "DEBT_MISMATCH",
      message: `reconstructed ${reconstructedDebt} != cache ${customerDebt}`,
    });
  }

  const stock: ReconcileReport["stock"] = [];
  for (const p of products) {
    const pm = moves.filter((m) => m.productId === p.id);
    const inicial = pm.some((m) => m.reason === "inicial");
    const sumDelta = pm.reduce((s, m) => s + m.delta, 0);
    const row: ReconcileReport["stock"][number] = {
      name: p.name,
      stock: p.stock,
      sumDelta: pm.length ? sumDelta : null,
      inicial,
    };
    if (inicial && sumDelta !== p.stock) {
      throw new Error(
        `stock mismatch ${p.name}: cache ${p.stock} vs Σ moves ${sumDelta}`,
      );
    }
    if (pm.length === 0 && p.stock > 0) {
      row.warning = "legacy stock without initial movement";
      warnings.push({
        code: "LEGACY_STOCK_NO_INICIAL",
        message: `${p.name}: stock ${p.stock} with zero stock_moves`,
      });
    } else if (!inicial && pm.length > 0) {
      row.warning = "moves without inicial; cache trusted";
      warnings.push({
        code: "STOCK_MOVES_WITHOUT_INICIAL",
        message: `${p.name}: ${pm.length} moves, no inicial; stock cache kept`,
      });
    }
    stock.push(row);
  }

  let orphans = 0;
  for (const s of sales) {
    if (s.customerId && !customers.some((c) => c.id === s.customerId)) orphans += 1;
  }
  for (const l of lines) {
    if (!sales.some((s) => s.id === l.saleId)) orphans += 1;
    if (!products.some((p) => p.id === l.productId)) orphans += 1;
  }
  for (const p of payments) {
    if (!customers.some((c) => c.id === p.customerId)) orphans += 1;
  }
  for (const m of moves) {
    if (!products.some((p) => p.id === m.productId)) orphans += 1;
  }
  for (const m of cashMoves) {
    if (m.sessionId && !sessions.some((s) => s.id === m.sessionId)) orphans += 1;
  }
  for (const d of initials) {
    if (!customers.some((c) => c.id === d.customerId)) orphans += 1;
  }

  const countsOk = Object.values(counts).every((c) => c.ok);
  const ok = countsOk && debtOk && orphans === 0;

  return {
    counts,
    amounts: {
      salesTotal,
      creditSales,
      paymentsTotal,
      initialDebtTotal,
      expensesTotal,
      cashInEfectivo,
      cashOutEfectivo,
      nequiIn,
      nequiOut,
    },
    balances: {
      customerDebt,
      reconstructedDebt,
      debtOk,
      cashExpectedEfectivo,
      nequiExpected,
    },
    stock,
    orphans,
    warnings,
    ok,
  };
}
