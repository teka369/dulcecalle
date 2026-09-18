/**
 * Fase 6.9 preflight. Read-only analysis of a Dexie snapshot.
 * Never imports to Postgres. Never treats TEST_FIXTURE as DEXIE_REAL.
 */
import { GIFTED_STOCK_NOTE } from "@/domain/inventory";
import { isDexieNumericId, isRemoteUuid } from "./identity";
import {
  SNAPSHOT_TABLES,
  type DexieSnapshot,
  type SnapshotTable,
} from "@/storage/snapshot";

export type ClassLabel = "REAL" | "DEMO_LIKELY" | "UNKNOWN";

export type PreflightReport = {
  sourceRejected?: string;
  counts: Record<SnapshotTable, number>;
  checksum: string;
  initialDebtSum: number;
  initialDebtReference: "MATCH" | "DIFFERENT" | "EMPTY";
  debt: {
    matches: number;
    mismatches: Array<{
      customerId: number;
      name: string;
      stored: number;
      calculated: number;
      diff: number;
    }>;
  };
  stock: {
    withInicialOk: number;
    mismatches: string[];
    legacyWithoutInicial: string[];
    stockPositiveCostZero: string[];
  };
  sales: { total: number; paid: number; partial: number; credit: number; bad: string[] };
  payments: { count: number; efectivo: number; nequi: number };
  returns: { count: number; debtReduced: number; refund: number };
  cash: {
    days: Array<{
      localDate: string;
      opening: number;
      efectivoMoves: number;
      expected: number;
      closed: boolean;
      counted: number | null;
      difference: number | null;
    }>;
  };
  nequi: { in: number; out: number; expected: number };
  expenses: number;
  aportes: number;
  retiros: number;
  compras: number;
  shrink: { me_lo_comi: number; regalar: number; perdido: number };
  suppliers: number;
  orphans: string[];
  requestIds: {
    valid: number;
    legacy: number;
    missing: number;
    duplicate: string[];
  };
  demo: { label: ClassLabel; evidence: string[] };
  historicalSnapshots: number;
  initialDebtContamination: string[];
  importerBlockers: string[];
  financials: Record<string, number>;
};

const DEMO_NAMES = new Set([
  "Doña Rosa",
  "Carlos",
  "Chicle menta",
  "Chocolate barra",
  "Gomitas oso",
  "Caramelo duro",
  "Bombón café",
  "Distribuidora Sol",
]);

const REQUIRED_TABLES: SnapshotTable[] = [...SNAPSHOT_TABLES];

type Row = Record<string, unknown>;

function rows(snap: DexieSnapshot, table: SnapshotTable): Row[] {
  return (snap.tables[table] ?? []) as Row[];
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function idOf(v: unknown): number | null {
  return isDexieNumericId(v) ? v : null;
}

export function rejectNonRealSource(input: unknown): string | null {
  if (!input || typeof input !== "object") return "not an object";
  const src = (input as { source?: unknown }).source;
  if (src === "TEST_FIXTURE") {
    return "TEST_FIXTURE is not DEXIE_REAL";
  }
  if (src !== "DEXIE") return `unexpected source ${String(src)}`;
  return null;
}

export function analyzePreflight(snap: DexieSnapshot): PreflightReport {
  const rejected = rejectNonRealSource(snap);
  if (rejected) {
    return emptyReport(snap, rejected);
  }

  const blockers: string[] = [];
  for (const t of REQUIRED_TABLES) {
    if (!Array.isArray(snap.tables[t])) blockers.push(`missing table ${t}`);
  }

  const products = rows(snap, "products");
  const customers = rows(snap, "customers");
  const sales = rows(snap, "sales");
  const lines = rows(snap, "saleLines");
  const returns = rows(snap, "saleReturns");
  const returnLines = rows(snap, "saleReturnLines");
  const moves = rows(snap, "stockMoves");
  const sessions = rows(snap, "cashSessions");
  const cashMoves = rows(snap, "cashMoves");
  const payments = rows(snap, "customerPayments");
  const initials = rows(snap, "initialDebts");
  const expenses = rows(snap, "expenses");
  const suppliers = rows(snap, "suppliers");
  const settings = rows(snap, "settings");

  const productIds = new Set(products.map((p) => idOf(p.id)).filter((x): x is number => x != null));
  const customerIds = new Set(customers.map((c) => idOf(c.id)).filter((x): x is number => x != null));
  const saleIds = new Set(sales.map((s) => idOf(s.id)).filter((x): x is number => x != null));
  const lineIds = new Set(lines.map((l) => idOf(l.id)).filter((x): x is number => x != null));
  const returnIds = new Set(returns.map((r) => idOf(r.id)).filter((x): x is number => x != null));
  const sessionIds = new Set(sessions.map((s) => idOf(s.id)).filter((x): x is number => x != null));

  const orphans: string[] = [];
  for (const s of sales) {
    const cid = s.customerId;
    if (cid != null && !customerIds.has(num(cid))) orphans.push(`sale#${s.id} customer ${cid}`);
    if (!isDexieNumericId(s.id)) blockers.push(`sale id not Dexie int: ${String(s.id)}`);
  }
  for (const l of lines) {
    if (!saleIds.has(num(l.saleId))) orphans.push(`saleLine#${l.id} sale ${l.saleId}`);
    if (!productIds.has(num(l.productId))) orphans.push(`saleLine#${l.id} product ${l.productId}`);
  }
  for (const r of returns) {
    if (!saleIds.has(num(r.saleId))) orphans.push(`return#${r.id} sale ${r.saleId}`);
  }
  for (const l of returnLines) {
    if (!returnIds.has(num(l.returnId))) orphans.push(`returnLine#${l.id} return ${l.returnId}`);
    if (!lineIds.has(num(l.saleLineId))) orphans.push(`returnLine#${l.id} saleLine ${l.saleLineId}`);
  }
  for (const m of moves) {
    if (!productIds.has(num(m.productId))) orphans.push(`stockMove#${m.id} product ${m.productId}`);
  }
  for (const p of payments) {
    if (!customerIds.has(num(p.customerId))) orphans.push(`payment#${p.id} customer ${p.customerId}`);
  }
  for (const d of initials) {
    if (!customerIds.has(num(d.customerId))) orphans.push(`initialDebt#${d.id} customer ${d.customerId}`);
  }
  for (const m of cashMoves) {
    if (m.sessionId != null && !sessionIds.has(num(m.sessionId))) {
      orphans.push(`cashMove#${m.id} session ${m.sessionId}`);
    }
  }

  const creditByCustomer = new Map<number, number>();
  const paidKind = { paid: 0, partial: 0, credit: 0 };
  const saleBad: string[] = [];
  let salesTotal = 0;
  for (const s of sales) {
    const id = num(s.id);
    const total = num(s.saleTotal);
    salesTotal += total;
    const kind = String(s.paymentKind);
    if (kind === "paid" || kind === "partial" || kind === "credit") paidKind[kind] += 1;
    const lineSum = lines
      .filter((l) => num(l.saleId) === id)
      .reduce((a, l) => a + num(l.lineTotal), 0);
    if (lineSum !== total) saleBad.push(`sale#${id} total ${total} vs lines ${lineSum}`);
    if (num(s.credit) > 0 && s.customerId != null) {
      creditByCustomer.set(
        num(s.customerId),
        (creditByCustomer.get(num(s.customerId)) ?? 0) + num(s.credit),
      );
    }
  }

  const payByCustomer = new Map<number, number>();
  let payEfectivo = 0;
  let payNequi = 0;
  for (const p of payments) {
    payByCustomer.set(num(p.customerId), (payByCustomer.get(num(p.customerId)) ?? 0) + num(p.amount));
    if (p.method === "Nequi") payNequi += num(p.amount);
    else payEfectivo += num(p.amount);
  }

  const retByCustomer = new Map<number, number>();
  let debtReduced = 0;
  let refund = 0;
  for (const r of returns) {
    debtReduced += num(r.debtReduced);
    refund += num(r.refundAmount);
    const sale = sales.find((s) => num(s.id) === num(r.saleId));
    if (sale?.customerId != null && num(r.debtReduced) > 0) {
      retByCustomer.set(
        num(sale.customerId),
        (retByCustomer.get(num(sale.customerId)) ?? 0) + num(r.debtReduced),
      );
    }
  }

  const initialByCustomer = new Map<number, number>();
  let initialDebtSum = 0;
  for (const d of initials) {
    initialDebtSum += num(d.amount);
    initialByCustomer.set(
      num(d.customerId),
      (initialByCustomer.get(num(d.customerId)) ?? 0) + num(d.amount),
    );
  }

  const debtMismatches: PreflightReport["debt"]["mismatches"] = [];
  let debtMatches = 0;
  for (const c of customers) {
    const cid = num(c.id);
    const calculated =
      (initialByCustomer.get(cid) ?? 0) +
      (creditByCustomer.get(cid) ?? 0) -
      (payByCustomer.get(cid) ?? 0) -
      (retByCustomer.get(cid) ?? 0);
    const stored = num(c.debt);
    if (calculated === stored) debtMatches += 1;
    else {
      debtMismatches.push({
        customerId: cid,
        name: String(c.name ?? ""),
        stored,
        calculated,
        diff: stored - calculated,
      });
    }
  }

  const initialDebtContamination: string[] = [];
  for (const d of initials) {
    const cid = num(d.customerId);
    const relatedSales = sales.filter((s) => num(s.customerId) === cid && num(s.saleTotal) === num(d.amount));
    if (relatedSales.length) {
      initialDebtContamination.push(
        `initialDebt#${d.id} amount ${d.amount} equals a sale total for customer ${cid} (inspect; not auto-classified)`,
      );
    }
  }

  const stockMismatches: string[] = [];
  const legacyWithoutInicial: string[] = [];
  const stockPositiveCostZero: string[] = [];
  let withInicialOk = 0;
  for (const p of products) {
    const pid = num(p.id);
    const pm = moves.filter((m) => num(m.productId) === pid);
    const inicial = pm.filter((m) => m.reason === "inicial");
    const sum = pm.reduce((a, m) => a + num(m.delta), 0);
    if (inicial.length > 0) {
      if (sum === num(p.stock)) withInicialOk += 1;
      else stockMismatches.push(`${p.name}: stock ${p.stock} vs Σ ${sum}`);
    } else if (pm.length === 0 && num(p.stock) > 0) {
      legacyWithoutInicial.push(String(p.name));
    }
    if (num(p.stock) > 0 && num(p.avgCost) === 0) {
      const gifted = inicial.some(
        (m) => num(m.unitCost) === 0 && String(m.note ?? "") === GIFTED_STOCK_NOTE,
      );
      if (!gifted) stockPositiveCostZero.push(String(p.name));
    }
  }

  let historicalSnapshots = 0;
  for (const l of lines) {
    const p = products.find((x) => num(x.id) === num(l.productId));
    if (!p) continue;
    if (num(l.unitPrice) !== num(p.price) || num(l.unitCost) !== num(p.avgCost)) {
      historicalSnapshots += 1;
    }
  }

  const days: PreflightReport["cash"]["days"] = [];
  for (const s of sessions) {
    const localDate = String(s.localDate);
    const opening = num(s.openingFloat);
    const dayMoves = cashMoves.filter((m) => num(m.sessionId) === num(s.id) && m.method === "Efectivo");
    let efectivoMoves = 0;
    for (const m of dayMoves) {
      efectivoMoves += m.direction === "in" ? num(m.amount) : -num(m.amount);
    }
    days.push({
      localDate,
      opening,
      efectivoMoves,
      expected: opening + efectivoMoves,
      closed: s.closedAt != null,
      counted: s.closingCount == null ? null : num(s.closingCount),
      difference: s.difference == null ? null : num(s.difference),
    });
  }

  let nequiIn = 0;
  let nequiOut = 0;
  let aportes = 0;
  let retiros = 0;
  let compras = 0;
  for (const m of cashMoves) {
    const amt = num(m.amount);
    if (m.method === "Nequi") {
      if (m.direction === "in") nequiIn += amt;
      else nequiOut += amt;
    }
    if (m.kind === "aporte") aportes += amt;
    if (m.kind === "retiro") retiros += amt;
    if (m.kind === "compra") compras += amt;
  }

  const shrink = { me_lo_comi: 0, regalar: 0, perdido: 0 };
  for (const m of moves) {
    if (m.reason === "me_lo_comi") shrink.me_lo_comi += 1;
    if (m.reason === "regalar") shrink.regalar += 1;
    if (m.reason === "perdido") shrink.perdido += 1;
  }

  const reqBuckets = { valid: 0, legacy: 0, missing: 0, duplicate: [] as string[] };
  const seen = new Map<string, number>();
  const withRequest = [
    ...sales.map((r) => ["sales", r] as const),
    ...payments.map((r) => ["payments", r] as const),
    ...returns.map((r) => ["returns", r] as const),
    ...initials.map((r) => ["initialDebts", r] as const),
    ...expenses.map((r) => ["expenses", r] as const),
    ...moves.map((r) => ["stockMoves", r] as const),
    ...cashMoves.map((r) => ["cashMoves", r] as const),
  ];
  for (const [table, r] of withRequest) {
    const rid = r.requestId;
    if (rid == null || rid === "") {
      reqBuckets.missing += 1;
      continue;
    }
    const key = `${table}:${String(rid)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    if (isRemoteUuid(rid)) reqBuckets.valid += 1;
    else reqBuckets.legacy += 1;
  }
  for (const [k, n] of seen) {
    if (n > 1) reqBuckets.duplicate.push(k);
  }

  const evidence: string[] = [];
  let demoHits = 0;
  let nonDemo = 0;
  for (const p of products) {
    if (DEMO_NAMES.has(String(p.name))) {
      demoHits += 1;
      evidence.push(`product:${p.name}`);
    } else nonDemo += 1;
  }
  for (const c of customers) {
    if (DEMO_NAMES.has(String(c.name))) {
      demoHits += 1;
      evidence.push(`customer:${c.name}`);
    } else nonDemo += 1;
  }
  const demoLoaded = settings.find((s) => s.key === "demoLoaded");
  if (demoLoaded?.value === "1") evidence.push("settings.demoLoaded=1");
  let label: ClassLabel = "UNKNOWN";
  if (demoHits > 0 && nonDemo === 0 && demoLoaded?.value === "1") label = "DEMO_LIKELY";
  else if (demoHits === 0 && nonDemo > 0 && demoLoaded?.value !== "1") label = "REAL";
  else label = "UNKNOWN";

  let initialDebtReference: PreflightReport["initialDebtReference"] = "DIFFERENT";
  if (initials.length === 0) initialDebtReference = "EMPTY";
  else if (initialDebtSum === 45_200) initialDebtReference = "MATCH";

  const expenseSum = expenses.reduce((a, e) => a + num(e.amount), 0);

  return {
    counts: snap.recordCounts,
    checksum: snap.checksum,
    initialDebtSum,
    initialDebtReference,
    debt: { matches: debtMatches, mismatches: debtMismatches },
    stock: {
      withInicialOk,
      mismatches: stockMismatches,
      legacyWithoutInicial,
      stockPositiveCostZero,
    },
    sales: {
      total: salesTotal,
      paid: paidKind.paid,
      partial: paidKind.partial,
      credit: paidKind.credit,
      bad: saleBad,
    },
    payments: { count: payments.length, efectivo: payEfectivo, nequi: payNequi },
    returns: { count: returns.length, debtReduced, refund },
    cash: { days },
    nequi: { in: nequiIn, out: nequiOut, expected: nequiIn - nequiOut },
    expenses: expenseSum,
    aportes,
    retiros,
    compras,
    shrink,
    suppliers: suppliers.length,
    orphans,
    requestIds: reqBuckets,
    demo: { label, evidence },
    historicalSnapshots,
    initialDebtContamination,
    importerBlockers: blockers,
    financials: {
      salesTotal,
      creditSales: [...creditByCustomer.values()].reduce((a, b) => a + b, 0),
      payments: payEfectivo + payNequi,
      initialDebts: initialDebtSum,
      returnsDebtReduced: debtReduced,
      expenses: expenseSum,
      aportes,
      retiros,
      compras,
      nequi: nequiIn - nequiOut,
      stockUnits: products.reduce((a, p) => a + num(p.stock), 0),
      customers: customers.length,
      products: products.length,
      suppliers: suppliers.length,
    },
  };
}

function emptyReport(snap: DexieSnapshot | { checksum?: string }, reason: string): PreflightReport {
  const zeroCounts = Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, 0])) as Record<
    SnapshotTable,
    number
  >;
  return {
    sourceRejected: reason,
    counts: "recordCounts" in snap && snap.recordCounts ? snap.recordCounts : zeroCounts,
    checksum: "checksum" in snap && typeof snap.checksum === "string" ? snap.checksum : "",
    initialDebtSum: 0,
    initialDebtReference: "EMPTY",
    debt: { matches: 0, mismatches: [] },
    stock: { withInicialOk: 0, mismatches: [], legacyWithoutInicial: [], stockPositiveCostZero: [] },
    sales: { total: 0, paid: 0, partial: 0, credit: 0, bad: [] },
    payments: { count: 0, efectivo: 0, nequi: 0 },
    returns: { count: 0, debtReduced: 0, refund: 0 },
    cash: { days: [] },
    nequi: { in: 0, out: 0, expected: 0 },
    expenses: 0,
    aportes: 0,
    retiros: 0,
    compras: 0,
    shrink: { me_lo_comi: 0, regalar: 0, perdido: 0 },
    suppliers: 0,
    orphans: [],
    requestIds: { valid: 0, legacy: 0, missing: 0, duplicate: [] },
    demo: { label: "UNKNOWN", evidence: [] },
    historicalSnapshots: 0,
    initialDebtContamination: [],
    importerBlockers: [reason],
    financials: {},
  };
}

