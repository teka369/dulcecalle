import { randomUUID } from "crypto";
import {
  CashDirection,
  CashMoveKind,
  type PayMethod,
  type PrismaClient,
  StockMoveReason,
} from "@prisma/client";
import { detectDemoSignals } from "./demo-signals";
import {
  dateKeyUtc,
  epochToUtcDate,
  localDateToPg,
  occurredOnFromEpoch,
} from "./dates";
import { mapRequestId } from "./request-id";
import { assertTestImportEnv } from "./safety";
import type { DexieDump, ImportResult, ImportWarning } from "./types";

export const IMPORT_ORDER = [
  "settings",
  "products",
  "customers",
  "suppliers",
  "cash_sessions",
  "sales",
  "sale_lines",
  "sale_returns",
  "sale_return_lines",
  "stock_moves",
  "customer_payments",
  "initial_debts",
  "expenses",
  "cash_moves",
] as const;

type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

const REF_TABLE: Record<string, (typeof IMPORT_ORDER)[number] | "products" | "sales"> = {
  sale: "sales",
  product: "products",
  customerPayment: "customer_payments",
  expense: "expenses",
  saleReturn: "sale_returns",
  stockMove: "stock_moves",
};

function isCashKind(k: string): k is CashMoveKind {
  return (Object.values(CashMoveKind) as string[]).includes(k);
}

function isStockReason(k: string): k is StockMoveReason {
  return (Object.values(StockMoveReason) as string[]).includes(k);
}

export type ImportOptions = {
  businessId: string;
  failAfter?: "products";
};

function assertAllowedDump(dump: DexieDump): void {
  if (dump.source === "TEST_FIXTURE" && dump.notProduction === true) return;
  if (dump.source === "DEXIE" && dump.claim === "DEVICE_COPY") return;
  throw new Error(
    "Import refused: dump must be TEST_FIXTURE or DEXIE DEVICE_COPY under TEST.",
  );
}

export async function importDexieDump(
  prisma: PrismaClient,
  dump: DexieDump,
  opts: ImportOptions,
): Promise<ImportResult> {
  assertTestImportEnv(process.env.DATABASE_URL);
  assertAllowedDump(dump);

  const warnings: ImportWarning[] = detectDemoSignals(dump);

  await prisma.$transaction(
    async (tx) => {
      await runImport(tx, dump, opts, warnings);
    },
    { timeout: 60_000, maxWait: 15_000 },
  );

  const mapSize = await prisma.importIdMap.count({
    where: { businessId: opts.businessId },
  });
  return { businessId: opts.businessId, warnings, mapSize };
}

async function runImport(
  tx: Tx,
  dump: DexieDump,
  opts: ImportOptions,
  warnings: ImportWarning[],
): Promise<void> {
  const businessId = opts.businessId;
  const map = new Map<string, string>();
  const existing = await tx.importIdMap.findMany({ where: { businessId } });
  for (const row of existing) {
    map.set(`${row.tableName}:${row.dexieId}`, row.pgId);
  }

  const ensure = async (
    table: string,
    dexieId: number,
    insert: (id: string) => Promise<void>,
  ): Promise<string> => {
    const key = `${table}:${dexieId}`;
    const hit = map.get(key);
    if (hit) return hit;
    const id = randomUUID();
    await insert(id);
    await tx.importIdMap.create({
      data: { businessId, tableName: table, dexieId, pgId: id },
    });
    map.set(key, id);
    return id;
  };

  const lookup = (table: string, dexieId: number): string => {
    const id = map.get(`${table}:${dexieId}`);
    if (!id) throw new Error(`FK miss ${table}#${dexieId}`);
    return id;
  };

  const mapRef = (refType: string | undefined, refId: number | undefined): string | null => {
    if (refId == null) return null;
    if (!refType) throw new Error(`refId ${refId} without refType`);
    const table = REF_TABLE[refType];
    if (!table) throw new Error(`unknown refType ${refType}`);
    return lookup(table, refId);
  };

  for (const s of dump.tables.settings) {
    await tx.setting.upsert({
      where: { businessId_key: { businessId, key: s.key } },
      create: { businessId, key: s.key, value: s.value },
      update: { value: s.value },
    });
  }

  for (const p of dump.tables.products) {
    await ensure("products", p.id, async (id) => {
      await tx.product.create({
        data: {
          id,
          businessId,
          name: p.name,
          category: p.category,
          price: BigInt(p.price),
          avgCost: BigInt(p.avgCost),
          stock: p.stock,
          lowStockAt: p.lowStockAt,
          createdAt: epochToUtcDate(p.createdAt),
          updatedAt: epochToUtcDate(p.updatedAt),
          legacyDexieId: p.id,
        },
      });
    });
  }

  if (opts.failAfter === "products") {
    throw new Error("dry-run rollback probe");
  }

  for (const c of dump.tables.customers) {
    await ensure("customers", c.id, async (id) => {
      await tx.customer.create({
        data: {
          id,
          businessId,
          name: c.name,
          phone: c.phone ?? null,
          debt: BigInt(c.debt),
          createdAt: epochToUtcDate(c.createdAt),
          updatedAt: epochToUtcDate(c.updatedAt),
          legacyDexieId: c.id,
        },
      });
    });
  }

  for (const s of dump.tables.suppliers) {
    await ensure("suppliers", s.id, async (id) => {
      await tx.supplier.create({
        data: {
          id,
          businessId,
          name: s.name,
          phone: s.phone ?? null,
          notes: s.notes ?? null,
          createdAt: epochToUtcDate(s.createdAt),
          updatedAt: epochToUtcDate(s.updatedAt),
          legacyDexieId: s.id,
        },
      });
    });
  }

  for (const s of dump.tables.cashSessions) {
    const opened = epochToUtcDate(s.openedAt);
    const openedKey = dateKeyUtc(occurredOnFromEpoch(s.openedAt));
    if (openedKey !== s.localDate) {
      warnings.push({
        code: "LOCAL_DATE_MISMATCH",
        message: `session Dexie#${s.id} localDate ${s.localDate} vs opened_at Bogota ${openedKey}; keeping localDate`,
      });
    }
    await ensure("cash_sessions", s.id, async (id) => {
      await tx.cashSession.create({
        data: {
          id,
          businessId,
          localDate: localDateToPg(s.localDate),
          openedAt: opened,
          closedAt: s.closedAt == null ? null : epochToUtcDate(s.closedAt),
          openingFloat: BigInt(s.openingFloat),
          closingCount: s.closingCount == null ? null : BigInt(s.closingCount),
          expectedEfectivo:
            s.expectedEfectivo == null ? null : BigInt(s.expectedEfectivo),
          expectedNequi: s.expectedNequi == null ? null : BigInt(s.expectedNequi),
          difference: s.difference == null ? null : BigInt(s.difference),
          note: s.note ?? null,
          legacyDexieId: s.id,
        },
      });
    });
  }

  const methodBySale = new Map<number, PayMethod>();
  for (const m of dump.tables.cashMoves) {
    if (m.kind === "sale" && m.refType === "sale" && m.refId != null) {
      methodBySale.set(m.refId, m.method);
    }
  }

  for (const s of dump.tables.sales) {
    const rid = mapRequestId(s.requestId);
    const method =
      s.paymentKind === "credit"
        ? null
        : (methodBySale.get(s.id) ?? null);
    await ensure("sales", s.id, async (id) => {
      await tx.sale.create({
        data: {
          id,
          businessId,
          customerId:
            s.customerId == null ? null : lookup("customers", s.customerId),
          paymentKind: s.paymentKind,
          method,
          saleTotal: BigInt(s.saleTotal),
          amountReceived: BigInt(s.amountReceived),
          credit: BigInt(s.credit),
          requestId: rid.requestId,
          legacyRequestId: rid.legacyRequestId,
          note: s.note ?? null,
          occurredOn: occurredOnFromEpoch(s.createdAt),
          createdAt: epochToUtcDate(s.createdAt),
          legacyDexieId: s.id,
        },
      });
    });
  }

  for (const l of dump.tables.saleLines) {
    await ensure("sale_lines", l.id, async (id) => {
      await tx.saleLine.create({
        data: {
          id,
          businessId,
          saleId: lookup("sales", l.saleId),
          productId: lookup("products", l.productId),
          productName: l.productName,
          qty: l.qty,
          unitPrice: BigInt(l.unitPrice),
          unitCost: BigInt(l.unitCost),
          lineTotal: BigInt(l.lineTotal),
          legacyDexieId: l.id,
        },
      });
    });
  }

  for (const r of dump.tables.saleReturns) {
    const rid = mapRequestId(r.requestId);
    await ensure("sale_returns", r.id, async (id) => {
      await tx.saleReturn.create({
        data: {
          id,
          businessId,
          saleId: lookup("sales", r.saleId),
          refundAmount: BigInt(r.refundAmount),
          debtReduced: BigInt(r.debtReduced),
          method: r.method,
          requestId: rid.requestId,
          note: r.note ?? null,
          occurredOn: occurredOnFromEpoch(r.createdAt),
          createdAt: epochToUtcDate(r.createdAt),
          legacyDexieId: r.id,
        },
      });
    });
  }

  for (const l of dump.tables.saleReturnLines) {
    await ensure("sale_return_lines", l.id, async (id) => {
      await tx.saleReturnLine.create({
        data: {
          id,
          businessId,
          returnId: lookup("sale_returns", l.returnId),
          saleLineId: lookup("sale_lines", l.saleLineId),
          productId: lookup("products", l.productId),
          qty: l.qty,
          unitPrice: BigInt(l.unitPrice),
          unitCost: BigInt(l.unitCost),
          legacyDexieId: l.id,
        },
      });
    });
  }

  for (const m of dump.tables.stockMoves) {
    if (!isStockReason(m.reason)) throw new Error(`bad stock reason ${m.reason}`);
    const rid = mapRequestId(m.requestId);
    await ensure("stock_moves", m.id, async (id) => {
      await tx.stockMove.create({
        data: {
          id,
          businessId,
          productId: lookup("products", m.productId),
          delta: m.delta,
          reason: m.reason,
          unitCost: BigInt(m.unitCost),
          supplierId:
            m.supplierId == null ? null : lookup("suppliers", m.supplierId),
          refType: m.refType ?? null,
          refId: mapRef(m.refType, m.refId),
          note: m.note ?? null,
          requestId: rid.requestId,
          occurredOn: occurredOnFromEpoch(m.createdAt),
          createdAt: epochToUtcDate(m.createdAt),
          legacyDexieId: m.id,
        },
      });
    });
  }

  for (const p of dump.tables.customerPayments) {
    const rid = mapRequestId(p.requestId);
    await ensure("customer_payments", p.id, async (id) => {
      await tx.customerPayment.create({
        data: {
          id,
          businessId,
          customerId: lookup("customers", p.customerId),
          amount: BigInt(p.amount),
          method: p.method,
          saleId: p.saleId == null ? null : lookup("sales", p.saleId),
          requestId: rid.requestId,
          note: p.note ?? null,
          occurredOn: occurredOnFromEpoch(p.createdAt),
          createdAt: epochToUtcDate(p.createdAt),
          legacyDexieId: p.id,
        },
      });
    });
  }

  for (const d of dump.tables.initialDebts) {
    const rid = mapRequestId(d.requestId);
    await ensure("initial_debts", d.id, async (id) => {
      await tx.initialDebt.create({
        data: {
          id,
          businessId,
          customerId: lookup("customers", d.customerId),
          amount: BigInt(d.amount),
          note: d.note ?? null,
          requestId: rid.requestId,
          occurredOn: occurredOnFromEpoch(d.createdAt),
          createdAt: epochToUtcDate(d.createdAt),
          legacyDexieId: d.id,
        },
      });
    });
  }

  for (const e of dump.tables.expenses) {
    const rid = mapRequestId(e.requestId);
    await ensure("expenses", e.id, async (id) => {
      await tx.expense.create({
        data: {
          id,
          businessId,
          amount: BigInt(e.amount),
          category: e.category,
          note: e.note ?? null,
          method: e.method,
          requestId: rid.requestId,
          occurredOn: occurredOnFromEpoch(e.createdAt),
          createdAt: epochToUtcDate(e.createdAt),
          legacyDexieId: e.id,
        },
      });
    });
  }

  for (const m of dump.tables.cashMoves) {
    if (!isCashKind(m.kind)) throw new Error(`bad cash kind ${m.kind}`);
    const kind: CashMoveKind = m.kind;
    const rid = mapRequestId(m.requestId);
    await ensure("cash_moves", m.id, async (id) => {
      await tx.cashMove.create({
        data: {
          id,
          businessId,
          amount: BigInt(m.amount),
          direction: m.direction === "in" ? CashDirection.in : CashDirection.out,
          method: m.method,
          kind,
          sessionId:
            m.sessionId == null ? null : lookup("cash_sessions", m.sessionId),
          refType: m.refType ?? null,
          refId: mapRef(m.refType, m.refId),
          requestId: rid.requestId,
          note: m.note ?? null,
          occurredOn: occurredOnFromEpoch(m.createdAt),
          createdAt: epochToUtcDate(m.createdAt),
          legacyDexieId: m.id,
        },
      });
    });
  }
}
