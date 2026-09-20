import { NetworkError } from "@/data/errors";
import { getPwaApi } from "@/data/pwa/api";
import { getPwaAuthSession } from "@/data/http/session";
import { getLocalDb, type DulceCalleLocalDB } from "@/data/local/db";
import { getOutboxStore, getOutboxSyncEngine, ConnectivityMonitor } from "@/data/local/outbox";
import { PENDING_SUPPLIER_MESSAGE } from "@/data/pwa/offline-catalog";
import { newEntityId, assertUuid } from "@/data/local/ids";
import type { LocalCashMove, LocalCashSession, LocalExpense } from "@/data/local/types";
import type { RemoteExpense, RemoteStockMove } from "@/data/http/mappers";
import type { DayCashSummary } from "@/store/cashStore";
import { addCop, subCop } from "@/domain/money";

function businessId(): string {
  const id = getPwaAuthSession().businessId;
  if (!id) throw new Error("Selecciona un negocio.");
  assertUuid(id, "businessId");
  return id;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function assertNonNegativeMoney(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(message);
}

function assertPositiveMoney(value: number, message: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(message);
}

async function openDependency(db: DulceCalleLocalDB, business: string): Promise<string[]> {
  const session = await db.cashSessions
    .where("[businessId+localDate]")
    .equals([business, todayLocal()])
    .first();
  if (!session || session.closedAt) return [];
  const item = await getOutboxStore().get(business, session.id);
  return item?.entity === "cashSession" && item.operation === "open"
    ? [item.operationId]
    : [];
}

function expectedLocal(session: LocalCashSession, moves: LocalCashMove[]) {
  let efectivo = session.openingFloat;
  let nequi = 0;
  for (const move of moves) {
    const delta = move.direction === "in" ? move.amount : -move.amount;
    if (move.method === "Efectivo") efectivo = addCop(efectivo, delta);
    else nequi = addCop(nequi, delta);
  }
  return { efectivo, nequi, total: addCop(efectivo, nequi) };
}

function mapLocalExpenses(rows: LocalExpense[]): RemoteExpense[] {
  return rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    category: row.category,
    method: row.method,
    note: row.note,
    occurredOn: row.occurredOn,
    createdAt: row.createdAt,
  }));
}

export async function getLocalCashSnapshot(): Promise<{
  summary: DayCashSummary;
  expenses: RemoteExpense[];
}> {
  const business = businessId();
  const db = getLocalDb();
  const date = todayLocal();
  const session = await db.cashSessions
    .where("[businessId+localDate]")
    .equals([business, date])
    .first();
  const moves = (await db.cashMoves.where("businessId").equals(business).toArray())
    .filter((row) => row.occurredOn === date)
    .sort((a, b) => a.createdAt - b.createdAt);
  const expenses = mapLocalExpenses(
    (await db.expenses.where("businessId").equals(business).toArray())
      .filter((row) => row.occurredOn === date)
      .sort((a, b) => b.createdAt - a.createdAt),
  );
  const base =
    session ??
    ({
      id: newEntityId(),
      businessId: business,
      localDate: date,
      openedAt: Date.now(),
      closedAt: null,
      openingFloat: 0,
      closingCount: null,
      expectedEfectivo: null,
      expectedNequi: null,
      difference: null,
      note: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies LocalCashSession);
  const expected = expectedLocal(base, moves);
  const entradas = moves
    .filter((move) => move.direction === "in")
    .reduce((total, move) => addCop(total, move.amount), 0);
  const salidas = moves
    .filter((move) => move.direction === "out")
    .reduce((total, move) => addCop(total, move.amount), 0);
  return {
    summary: {
      localDate: date,
      session: session
        ? {
            id: session.id,
            localDate: session.localDate,
            openedAt: session.openedAt,
            closedAt: session.closedAt,
            openingFloat: session.openingFloat,
            closingCount: session.closingCount,
            expectedEfectivo: session.expectedEfectivo,
            expectedNequi: session.expectedNequi,
            difference: session.difference,
          }
        : null,
      expected: {
        efectivo: expected.efectivo,
        nequi: expected.nequi,
        total: expected.total,
      },
      closed: session?.closedAt != null,
      moves: moves.map((move) => ({
        id: move.id,
        amount: move.amount,
        direction: move.direction,
        method: move.method,
        kind: move.kind,
        refType: move.refType,
        refId: move.refId,
        occurredOn: move.occurredOn,
        createdAt: move.createdAt,
      })),
      counted: session?.closingCount ?? null,
      difference: session?.difference ?? null,
      entradas,
      salidas,
    },
    expenses,
  };
}

async function ensureOpenDayEditable(business: string) {
  const session = await getLocalDb().cashSessions
    .where("[businessId+localDate]")
    .equals([business, todayLocal()])
    .first();
  if (session?.closedAt) throw new Error("La caja de hoy ya está cerrada.");
}

export type OfflineOperationResult<T> =
  | { mode: "online"; value: T }
  | { mode: "offline"; id: string };

export async function openCashWithOfflineFallback(
  openingFloat: number,
  requestId: string,
): Promise<OfflineOperationResult<Awaited<ReturnType<ReturnType<typeof getPwaApi>["cash"]["open"]>>>> {
  assertNonNegativeMoney(openingFloat, "El monto no puede ser negativo.");
  try {
    const value = await getPwaApi().cash.open(openingFloat, requestId);
    const business = businessId();
    const now = Date.now();
    await getLocalDb().cashSessions.put({
      id: value.id,
      businessId: business,
      localDate: value.localDate,
      openedAt: value.openedAt,
      closedAt: value.closedAt,
      openingFloat: value.openingFloat,
      closingCount: value.closingCount,
      expectedEfectivo: value.expectedEfectivo,
      expectedNequi: value.expectedNequi,
      difference: value.difference,
      note: null,
      createdAt: now,
      updatedAt: now,
      requestId,
    });
    return { mode: "online", value };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const business = businessId();
    const db = getLocalDb();
    const now = Date.now();
    const date = todayLocal();
    const id = await db.transaction("rw", [db.cashSessions, db.outbox], async () => {
      const existing = await db.cashSessions
        .where("[businessId+localDate]")
        .equals([business, date])
        .first();
      if (existing) {
        if (existing.closedAt) throw new Error("La caja de hoy ya está cerrada.");
        return existing.id;
      }
      const sessionId = newEntityId();
      await db.cashSessions.put({
        id: sessionId,
        businessId: business,
        localDate: date,
        openedAt: now,
        closedAt: null,
        openingFloat,
        closingCount: null,
        expectedEfectivo: null,
        expectedNequi: null,
        difference: null,
        note: null,
        createdAt: now,
        updatedAt: now,
        requestId,
      });
      await getOutboxStore().enqueue({
        operationId: sessionId,
        businessId: business,
        entity: "cashSession",
        operation: "open",
        requestId,
        payload: { openingFloat },
        dependsOn: [],
        localCreatedAt: now,
      });
      return sessionId;
    });
    return { mode: "offline", id };
  }
}

export async function closeCashWithOfflineFallback(
  sessionId: string,
  countedEfectivo: number,
  requestId: string,
): Promise<OfflineOperationResult<Awaited<ReturnType<ReturnType<typeof getPwaApi>["cash"]["close"]>>>> {
  assertNonNegativeMoney(countedEfectivo, "Revisa el monto contado.");
  try {
    const value = await getPwaApi().cash.close(sessionId, countedEfectivo, requestId);
    const business = businessId();
    const local = await getLocalDb().cashSessions.get(sessionId);
    if (local?.businessId !== business) throw new Error("La caja no pertenece al negocio seleccionado.");
    if (local) {
      await getLocalDb().cashSessions.put({
        ...local,
        closedAt: value.closedAt,
        closingCount: value.closingCount,
        expectedEfectivo: value.expectedEfectivo,
        expectedNequi: value.expectedNequi,
        difference: value.difference,
        updatedAt: Date.now(),
      });
    }
    return { mode: "online", value };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const business = businessId();
    const db = getLocalDb();
    const now = Date.now();
    const id = await db.transaction("rw", [db.cashSessions, db.cashMoves, db.outbox], async () => {
      const session = await db.cashSessions.get(sessionId);
      if (session?.businessId !== business) throw new Error("La caja no pertenece al negocio seleccionado.");
      if (!session) throw new Error("No hay una caja abierta.");
      if (session.closedAt) throw new Error("La caja ya está cerrada.");
      const moves = await db.cashMoves.where("businessId").equals(business).toArray();
      const expected = expectedLocal(
        session,
        moves.filter((move) => move.occurredOn === session.localDate),
      );
      const difference = subCop(countedEfectivo, expected.efectivo);
      const dependsOn = await openDependency(db, business);
      await db.cashSessions.put({
        ...session,
        closedAt: now,
        closingCount: countedEfectivo,
        expectedEfectivo: expected.efectivo,
        expectedNequi: expected.nequi,
        difference,
        updatedAt: now,
      });
      const operationId = newEntityId();
      await getOutboxStore().enqueue({
        operationId,
        businessId: business,
        entity: "cashSession",
        operation: "close",
        requestId,
        payload: { sessionId, countedEfectivo },
        dependsOn,
        localCreatedAt: now,
      });
      return operationId;
    });
    return { mode: "offline", id };
  }
}

async function ownerMove(
  kind: "aporte" | "retiro",
  amount: number,
  method: "Efectivo" | "Nequi",
  note: string | undefined,
  requestId: string,
) {
  assertPositiveMoney(amount, "El monto tiene que ser mayor a 0.");
  try {
    const value =
      kind === "aporte"
        ? await getPwaApi().cash.aporte({ amount, method, note: clean(note) }, requestId)
        : await getPwaApi().cash.retiro({ amount, method, note: clean(note) }, requestId);
    return { mode: "online" as const, value };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const business = businessId();
    const db = getLocalDb();
    const now = Date.now();
    await ensureOpenDayEditable(business);
    const dependsOn = await openDependency(db, business);
    const id = newEntityId();
    await db.transaction("rw", [db.cashMoves, db.outbox], async () => {
      await db.cashMoves.put({
        id,
        businessId: business,
        amount,
        direction: kind === "aporte" ? "in" : "out",
        method,
        kind,
        sessionId: null,
        refType: null,
        refId: null,
        requestId,
        note: clean(note) ?? null,
        occurredOn: todayLocal(),
        createdAt: now,
      });
      await getOutboxStore().enqueue({
        operationId: id,
        businessId: business,
        entity: "cashMove",
        operation: "create",
        requestId,
        payload: { kind, amount, method, note: clean(note) },
        dependsOn,
        localCreatedAt: now,
      });
    });
    return { mode: "offline" as const, id };
  }
}

export function recordAporteOffline(
  input: { amount: number; method: "Efectivo" | "Nequi"; note?: string },
  requestId: string,
) {
  return ownerMove("aporte", input.amount, input.method, input.note, requestId);
}

export function recordRetiroOffline(
  input: { amount: number; method: "Efectivo" | "Nequi"; note?: string },
  requestId: string,
) {
  return ownerMove("retiro", input.amount, input.method, input.note, requestId);
}

export async function recordExpenseWithOfflineFallback(
  input: { amount: number; category: string; method: "Efectivo" | "Nequi"; note?: string },
  requestId: string,
) {
  assertPositiveMoney(input.amount, "El monto tiene que ser mayor a 0.");
  const category = input.category.trim();
  if (!category) throw new Error("Di en qué se gastó.");
  try {
    return {
      mode: "online" as const,
      value: await getPwaApi().cash.recordExpense(input, requestId),
    };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const business = businessId();
    const db = getLocalDb();
    const now = Date.now();
    await ensureOpenDayEditable(business);
    const dependsOn = await openDependency(db, business);
    const id = newEntityId();
    await db.transaction("rw", [db.expenses, db.cashMoves, db.outbox], async () => {
      await db.expenses.put({
        id,
        businessId: business,
        amount: input.amount,
        category: input.category,
        note: clean(input.note) ?? null,
        method: input.method,
        requestId,
        occurredOn: todayLocal(),
        createdAt: now,
      });
      await db.cashMoves.put({
        id: newEntityId(),
        businessId: business,
        amount: input.amount,
        direction: "out",
        method: input.method,
        kind: "expense",
        sessionId: null,
        refType: "expense",
        refId: id,
        requestId,
        note: category,
        occurredOn: todayLocal(),
        createdAt: now,
      });
      await getOutboxStore().enqueue({
        operationId: id,
        businessId: business,
        entity: "expense",
        operation: "create",
        requestId,
        payload: { ...input, category, note: clean(input.note) },
        dependsOn,
        localCreatedAt: now,
      });
    });
    return { mode: "offline" as const, id };
  }
}

function roundedAvg(oldStock: number, oldAvg: number, qty: number, unitCost: number) {
  const next = oldStock + qty;
  return next <= 0 ? oldAvg : Math.round((oldAvg * oldStock + unitCost * qty) / next);
}

function reconcileCost(qty: number, unitCost: number, totalCost: number) {
  if (unitCost * qty === totalCost) return { unitCost, totalCost };
  if (totalCost > 0) return { unitCost: Math.round(totalCost / qty), totalCost };
  return { unitCost, totalCost: 0 };
}

export async function surtirWithOfflineFallback(
  input: {
    productId: string;
    qty: number;
    unitCost: number;
    totalCost: number;
    method: "Efectivo" | "Nequi";
    supplierId?: string | null;
    note?: string;
  },
  requestId: string,
) {
  try {
    return {
      mode: "online" as const,
      value: await getPwaApi().inventory.surtir(input.productId, input, requestId),
    };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const business = businessId();
    const db = getLocalDb();
    const now = Date.now();
    await ensureOpenDayEditable(business);
    const product = await db.products
      .where("[businessId+id]")
      .equals([business, input.productId])
      .first();
    if (!product) throw new Error("El producto no está disponible sin conexión.");
    if (product.archivedAt) throw new Error("El producto está archivado.");
    if (!Number.isInteger(input.qty) || input.qty <= 0) {
      throw new Error("La cantidad tiene que ser mayor a 0.");
    }
    if (
      !Number.isInteger(input.unitCost) ||
      input.unitCost < 0 ||
      !Number.isInteger(input.totalCost) ||
      input.totalCost < 0
    ) {
      throw new Error("Revisa el costo.");
    }
    const cost = reconcileCost(input.qty, input.unitCost, input.totalCost);
    const dependsOn = await openDependency(db, business);
    if (input.supplierId) {
      const supplier = await db.suppliers
        .where("[businessId+id]")
        .equals([business, input.supplierId])
        .first();
      if (!supplier) throw new Error("El proveedor no está disponible sin conexión.");
      if (supplier.requestId) {
        const dependency = await getOutboxStore().getByRequestId(business, supplier.requestId);
        if (dependency?.entity === "supplier" && dependency.operation === "create") {
          if (dependency.status !== "synced") throw new Error(PENDING_SUPPLIER_MESSAGE);
          dependsOn.push(dependency.operationId);
        }
      }
    }
    const moveId = newEntityId();
    await db.transaction("rw", [db.products, db.stockMoves, db.cashMoves, db.outbox], async () => {
      await db.products.put({
        ...product,
        stock: product.stock + input.qty,
        avgCost: roundedAvg(product.stock, product.avgCost, input.qty, cost.unitCost),
        updatedAt: now,
      });
      await db.stockMoves.put({
        id: moveId,
        businessId: business,
        productId: product.id,
        delta: input.qty,
        reason: "surtir",
        unitCost: cost.unitCost,
        supplierId: input.supplierId ?? null,
        refType: "purchase",
        refId: null,
        note: clean(input.note) ?? null,
        requestId,
        occurredOn: todayLocal(),
        createdAt: now,
      });
      if (cost.totalCost > 0) {
        await db.cashMoves.put({
          id: newEntityId(),
          businessId: business,
          amount: cost.totalCost,
          direction: "out",
          method: input.method,
          kind: "compra",
          sessionId: null,
          refType: "stockMove",
          refId: moveId,
          requestId: null,
          note: clean(input.note) ?? null,
          occurredOn: todayLocal(),
          createdAt: now,
        });
      }
      await getOutboxStore().enqueue({
        operationId: moveId,
        businessId: business,
        entity: "stockMove",
        operation: "surtir",
        requestId,
        payload: input,
        dependsOn: [...new Set(dependsOn)],
        localCreatedAt: now,
      });
    });
    return { mode: "offline" as const, id: moveId };
  }
}

export async function shrinkWithOfflineFallback(
  input: {
    productId: string;
    qty: number;
    reason: "me_lo_comi" | "regalar" | "perdido";
    note?: string;
  },
  requestId: string,
) {
  try {
    return {
      mode: "online" as const,
      value: await getPwaApi().inventory.shrink(
        input.productId,
        { qty: input.qty, reason: input.reason, note: input.note },
        requestId,
      ),
    };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const business = businessId();
    const db = getLocalDb();
    const now = Date.now();
    await ensureOpenDayEditable(business);
    const product = await db.products
      .where("[businessId+id]")
      .equals([business, input.productId])
      .first();
    if (!product) throw new Error("El producto no está disponible sin conexión.");
    if (product.archivedAt) throw new Error("El producto está archivado.");
    if (!Number.isInteger(input.qty) || input.qty <= 0 || product.stock < input.qty) {
      throw new Error("Stock insuficiente.");
    }
    const id = newEntityId();
    await db.transaction("rw", [db.products, db.stockMoves, db.outbox], async () => {
      await db.products.put({
        ...product,
        stock: product.stock - input.qty,
        updatedAt: now,
      });
      await db.stockMoves.put({
        id,
        businessId: business,
        productId: product.id,
        delta: -input.qty,
        reason: input.reason,
        unitCost: product.avgCost,
        supplierId: null,
        refType: "shrink",
        refId: null,
        note: clean(input.note) ?? null,
        requestId,
        occurredOn: todayLocal(),
        createdAt: now,
      });
      await getOutboxStore().enqueue({
        operationId: id,
        businessId: business,
        entity: "stockMove",
        operation: "shrink",
        requestId,
        payload: {
          productId: input.productId,
          qty: input.qty,
          reason: input.reason,
          note: clean(input.note),
        },
        dependsOn: [],
        localCreatedAt: now,
      });
    });
    return { mode: "offline" as const, id };
  }
}

export async function listLocalStockMoves(productId: string): Promise<RemoteStockMove[]> {
  const business = businessId();
  const rows = await getLocalDb().stockMoves.where("businessId").equals(business).toArray();
  return rows
    .filter((row) => row.productId === productId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((row) => ({
      id: row.id,
      productId: row.productId,
      delta: row.delta,
      reason: row.reason,
      unitCost: row.unitCost,
      supplierId: row.supplierId,
      note: row.note,
      occurredOn: row.occurredOn,
      createdAt: row.createdAt,
    }));
}

export async function syncPendingOperations(business: string) {
  return getOutboxSyncEngine().flush(
    business,
    async (item) => {
      if (item.entity === "cashSession" && item.operation === "open") {
        const payload = item.payload as { openingFloat: number };
        const remote = await getPwaApi().cash.open(payload.openingFloat, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "cashSession" && item.operation === "close") {
        const payload = item.payload as { sessionId: string; countedEfectivo: number };
        const dependency = item.dependsOn[0]
          ? await getOutboxStore().get(business, item.dependsOn[0])
          : undefined;
        const sessionId = dependency?.remoteId ?? payload.sessionId;
        const remote = await getPwaApi().cash.close(sessionId, payload.countedEfectivo, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "cashMove" && item.operation === "create") {
        const payload = item.payload as {
          kind: "aporte" | "retiro";
          amount: number;
          method: "Efectivo" | "Nequi";
          note?: string;
        };
        const remote =
          payload.kind === "aporte"
            ? await getPwaApi().cash.aporte(payload, item.requestId)
            : await getPwaApi().cash.retiro(payload, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "expense" && item.operation === "create") {
        const payload = item.payload as {
          amount: number;
          category: string;
          method: "Efectivo" | "Nequi";
          note?: string;
        };
        const remote = await getPwaApi().cash.recordExpense(payload, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "stockMove" && item.operation === "surtir") {
        const payload = item.payload as {
          productId: string;
          qty: number;
          unitCost: number;
          totalCost: number;
          method: "Efectivo" | "Nequi";
          supplierId?: string | null;
          note?: string;
        };
        const remote = await getPwaApi().inventory.surtir(payload.productId, payload, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "stockMove" && item.operation === "shrink") {
        const payload = item.payload as {
          productId: string;
          qty: number;
          reason: "me_lo_comi" | "regalar" | "perdido";
          note?: string;
        };
        const remote = await getPwaApi().inventory.shrink(
          payload.productId,
          payload,
          item.requestId,
        );
        return { remoteId: remote.id };
      }
      throw new Error("Operación de outbox no compatible con M6.8.");
    },
    (item) =>
      item.entity === "cashSession" ||
      item.entity === "cashMove" ||
      item.entity === "expense" ||
      item.entity === "stockMove",
  );
}

export function startOperationsSync() {
  const monitor = new ConnectivityMonitor();
  const run = () => {
    const business = getPwaAuthSession().businessId;
    if (business && monitor.online) void syncPendingOperations(business);
  };
  monitor.start();
  monitor.refresh();
  if (monitor.online) run();
  const unsubscribe = monitor.subscribe((online) => {
    if (online) run();
  });
  return () => {
    unsubscribe();
    monitor.stop();
  };
}
