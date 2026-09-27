import { NetworkError } from "../errors";
import type { RemoteReturn, RemoteSale } from "../http/mappers";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { getLocalStore } from "../local/store";
import { getOutboxStore, getOutboxSyncEngine } from "../local/outbox";
import { newEntityId } from "../local/ids";
import { customerToLocal } from "../local/read-cache";
import { mulCop } from "@/domain/money";
import type {
  LocalSale,
  LocalSaleLine,
  LocalSaleReturn,
  OutboxItem,
} from "../local/types";
import type { SaleDetailResult } from "./offline-sales";

export type ReturnLineInput = { saleLineId: string; qty: number };

type ReturnPayload = {
  saleRef: string;
  lines: ReturnLineInput[];
};

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isOpenReturn(op: OutboxItem): boolean {
  return (
    op.entity === "saleReturn" &&
    op.operation === "return" &&
    (op.status === "pending" ||
      op.status === "in_flight" ||
      (op.status === "failed" && op.nextAttemptAt != null))
  );
}

function readPayload(op: OutboxItem): ReturnPayload | null {
  const raw = op.payload;
  if (!raw || typeof raw !== "object") return null;
  const saleRef = (raw as { saleRef?: unknown }).saleRef;
  const lines = (raw as { lines?: unknown }).lines;
  if (typeof saleRef !== "string" || !Array.isArray(lines)) return null;
  const parsed: ReturnLineInput[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") continue;
    const saleLineId = (line as { saleLineId?: unknown }).saleLineId;
    const qty = (line as { qty?: unknown }).qty;
    if (typeof saleLineId !== "string" || typeof qty !== "number") continue;
    parsed.push({ saleLineId, qty });
  }
  return { saleRef, lines: parsed };
}

/** Server sale id. Never the local id when the outbox already has remoteId. */
export async function resolveRemoteSaleId(
  businessId: string,
  saleRef: string,
): Promise<string | null> {
  const direct = await getOutboxStore().get(businessId, saleRef);
  if (direct?.entity === "sale" && direct.operation === "create") {
    if (direct.status !== "synced" || !direct.remoteId) return null;
    return direct.remoteId;
  }
  const ops = await getLocalDb().outbox.where("businessId").equals(businessId).toArray();
  const byRemote = ops.find(
    (op) => op.entity === "sale" && op.operation === "create" && op.remoteId === saleRef,
  );
  if (byRemote) return byRemote.remoteId;
  return saleRef;
}

async function relatedSaleIds(businessId: string, saleId: string): Promise<string[]> {
  const ids = new Set<string>([saleId]);
  const ops = await getLocalDb().outbox.where("businessId").equals(businessId).toArray();
  for (const op of ops) {
    if (op.entity !== "sale" || op.operation !== "create") continue;
    if (op.operationId === saleId && op.remoteId) ids.add(op.remoteId);
    if (op.remoteId === saleId) ids.add(op.operationId);
  }
  return [...ids];
}

async function putReturnRows(
  businessId: string,
  saleRef: string,
  requestId: string,
  remote: RemoteReturn,
): Promise<void> {
  const db = getLocalDb();
  const method =
    remote.method === "Efectivo" || remote.method === "Nequi" ? remote.method : null;
  const row: LocalSaleReturn = {
    id: remote.id,
    businessId,
    saleId: saleRef,
    refundAmount: remote.refundAmount,
    debtReduced: remote.debtReduced,
    method,
    requestId,
    note: remote.note,
    occurredOn: remote.occurredOn,
    createdAt: remote.createdAt,
    updatedAt: Date.now(),
  };
  await db.saleReturns.put(row);
  for (const line of remote.lines) {
    await db.saleReturnLines.put({
      id: line.id,
      businessId,
      returnId: remote.id,
      saleLineId: line.saleLineId,
      productId: line.productId,
      qty: line.qty,
      unitPrice: line.unitPrice,
      unitCost: line.unitCost,
      createdAt: remote.createdAt,
    });
  }
}

/**
 * Remember a server sale so it can be returned offline.
 * If those line ids already belong to a local offline sale, keep that row:
 * the server id is the sale outbox remoteId, not a second copy.
 */
export async function persistServerSale(
  businessId: string,
  sale: RemoteSale,
  returns: RemoteReturn[] = [],
): Promise<void> {
  if (!sale?.id || !Array.isArray(sale.lines) || !sale.paymentKind) return;
  const db = getLocalDb();
  const localLines = await db.saleLines.where("businessId").equals(businessId).toArray();
  const twin = localLines.some(
    (line) => sale.lines.some((remote) => remote.id === line.id) && line.saleId !== sale.id,
  );
  if (twin) return;

  const now = Date.now();
  const paymentKind =
    sale.paymentKind === "partial" || sale.paymentKind === "credit"
      ? sale.paymentKind
      : "paid";
  const method =
    sale.method === "Efectivo" || sale.method === "Nequi" ? sale.method : null;
  const row: LocalSale = {
    id: sale.id,
    businessId,
    customerId: sale.customerId,
    paymentKind,
    method,
    saleTotal: sale.saleTotal,
    amountReceived: sale.amountReceived,
    credit: sale.credit,
    requestId: sale.id,
    note: sale.note,
    occurredOn: sale.occurredOn,
    createdAt: sale.createdAt,
    updatedAt: now,
  };

  await db.transaction(
    "rw",
    [db.sales, db.saleLines, db.saleReturns, db.saleReturnLines],
    async () => {
      await db.sales.put(row);
      const previous = await db.saleLines
        .where("[businessId+saleId]")
        .equals([businessId, sale.id])
        .toArray();
      for (const old of previous) {
        if (!sale.lines.some((line) => line.id === old.id)) await db.saleLines.delete(old.id);
      }
      for (const line of sale.lines) {
        const local: LocalSaleLine = {
          id: line.id,
          businessId,
          saleId: sale.id,
          productId: line.productId,
          productName: line.productName,
          qty: line.qty,
          unitPrice: line.unitPrice,
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
          createdAt: sale.createdAt,
        };
        await db.saleLines.put(local);
      }
      for (const ret of returns) {
        await putReturnRows(businessId, sale.id, ret.id, ret);
      }
    },
  );
}

/**
 * Stock increases only after the server accepts the return, once per requestId.
 * A lost 201 plus a retry must not add the quantity again. avgCost stays put.
 */
export async function applyReturnStockOnce(
  businessId: string,
  requestId: string,
  lines: Array<{ productId: string; qty: number; unitCost: number }>,
): Promise<void> {
  const db = getLocalDb();
  await db.transaction("rw", [db.products, db.stockMoves], async () => {
    const already = await db.stockMoves
      .where("businessId")
      .equals(businessId)
      .filter((move) => move.requestId === requestId)
      .first();
    if (already) return;
    const now = Date.now();
    const occurredOn = todayLocal();
    for (const line of lines) {
      if (!Number.isInteger(line.qty) || line.qty <= 0) continue;
      const product = await db.products
        .where("[businessId+id]")
        .equals([businessId, line.productId])
        .first();
      if (product && product.businessId === businessId) {
        await db.products.put({
          ...product,
          stock: product.stock + line.qty,
          updatedAt: now,
        });
      }
      await db.stockMoves.put({
        id: newEntityId(),
        businessId,
        productId: line.productId,
        delta: line.qty,
        reason: "devolucion",
        unitCost: line.unitCost,
        supplierId: null,
        refType: "saleReturn",
        refId: null,
        note: null,
        requestId,
        occurredOn,
        createdAt: now,
      });
    }
  });
}

async function reconcileReturnCustomer(
  businessId: string,
  saleRef: string,
): Promise<void> {
  const db = getLocalDb();
  const sale = await db.sales.get(saleRef);
  if (!sale?.customerId) return;
  try {
    const customer = await getPwaApi().customers.get(sale.customerId);
    await getLocalStore().customers.put(
      customerToLocal(customer, businessId, Date.now()),
    );
  } catch {
    // The return is already synced; customer cache can reconcile next cycle.
  }
}

async function openReturnQty(
  businessId: string,
  saleIds: string[],
): Promise<{ qty: Map<string, number>; pending: boolean }> {
  const qty = new Map<string, number>();
  let pending = false;
  const ops = await getLocalDb().outbox.where("businessId").equals(businessId).toArray();
  for (const op of ops) {
    if (!isOpenReturn(op)) continue;
    const payload = readPayload(op);
    if (!payload || !saleIds.includes(payload.saleRef)) continue;
    pending = true;
    for (const line of payload.lines) {
      qty.set(line.saleLineId, (qty.get(line.saleLineId) ?? 0) + line.qty);
    }
  }
  return { qty, pending };
}

export async function loadLocalReturnable(
  businessId: string,
  routeId: string,
): Promise<SaleDetailResult | null> {
  const db = getLocalDb();
  const ids = await relatedSaleIds(businessId, routeId);
  let sale = await db.sales.get(routeId);
  if (!sale || sale.businessId !== businessId) {
    for (const id of ids) {
      const candidate = await db.sales.get(id);
      if (candidate && candidate.businessId === businessId) {
        sale = candidate;
        break;
      }
    }
  }
  if (!sale || sale.businessId !== businessId) return null;

  const saleIds = [...new Set([sale.id, ...ids])];
  const lines = await db.saleLines
    .where("[businessId+saleId]")
    .equals([businessId, sale.id])
    .toArray();
  const returns = (await db.saleReturns.where("businessId").equals(businessId).toArray()).filter(
    (ret) => saleIds.includes(ret.saleId),
  );
  const returned = new Map<string, number>();
  for (const ret of returns) {
    const retLines = await db.saleReturnLines.where("returnId").equals(ret.id).toArray();
    for (const line of retLines) {
      if (line.businessId !== businessId) continue;
      returned.set(line.saleLineId, (returned.get(line.saleLineId) ?? 0) + line.qty);
    }
  }
  const open = await openReturnQty(businessId, saleIds);
  for (const [lineId, qty] of open.qty) {
    returned.set(lineId, (returned.get(lineId) ?? 0) + qty);
  }

  const detailed = lines.map((line) => {
    const returnedQty = returned.get(line.id) ?? 0;
    const remaining = Math.max(0, line.qty - returnedQty);
    return {
      id: line.id,
      productId: line.productId,
      productName: line.productName,
      qty: line.qty,
      unitPrice: line.unitPrice,
      unitCost: line.unitCost,
      lineTotal: line.lineTotal,
      returnedQty,
      remaining,
    };
  });
  const op = await getOutboxStore().get(businessId, sale.id);
  const pending = !!op && op.entity === "sale" && op.status !== "synced";
  const remainingValue = detailed.reduce(
    (sum, line) => sum + mulCop(line.unitPrice, line.remaining),
    0,
  );

  return {
    sale: {
      id: sale.id,
      customerId: sale.customerId,
      paymentKind: sale.paymentKind,
      method: sale.method,
      saleTotal: sale.saleTotal,
      amountReceived: sale.amountReceived,
      credit: sale.credit,
      note: sale.note,
      occurredOn: sale.occurredOn,
      createdAt: sale.createdAt,
      lines: detailed.map((line) => ({
        id: line.id,
        productId: line.productId,
        productName: line.productName,
        qty: line.qty,
        unitPrice: line.unitPrice,
        unitCost: line.unitCost,
        lineTotal: line.lineTotal,
      })),
      pending,
    },
    lines: detailed,
    remainingValue,
    returns: [],
    source: "cache",
    returnPending: open.pending,
  };
}

async function enqueueReturn(
  businessId: string,
  saleRef: string,
  lines: ReturnLineInput[],
  requestId: string,
): Promise<string> {
  const local = await loadLocalReturnable(businessId, saleRef);
  if (!local) throw new Error("Esta venta no está disponible sin conexión.");
  if (lines.length === 0) throw new Error("Elige qué se devuelve.");
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new Error("La cantidad tiene que ser mayor a 0.");
    }
    const known = local.lines.find((row) => row.id === line.saleLineId);
    if (!known) throw new Error("Ese producto no está en la venta.");
    if (line.qty > known.remaining) throw new Error("No se puede devolver más de lo vendido.");
  }

  const existing = await getOutboxStore().getByRequestId(businessId, requestId);
  if (existing) return existing.operationId;

  const saleOp = await getOutboxStore().get(businessId, local.sale.id);
  const dependsOn =
    saleOp?.entity === "sale" && saleOp.operation === "create" && saleOp.status !== "synced"
      ? [saleOp.operationId]
      : [];

  const operationId = newEntityId();
  await getOutboxStore().enqueue({
    operationId,
    businessId,
    entity: "saleReturn",
    operation: "return",
    requestId,
    payload: { saleRef: local.sale.id, lines },
    dependsOn,
    localCreatedAt: Date.now(),
  });
  return operationId;
}

export async function createReturnWithOfflineFallback(
  saleRef: string,
  lines: ReturnLineInput[],
  requestId: string,
): Promise<{ mode: "online"; returnId: string } | { mode: "offline"; operationId: string }> {
  const businessId = getPwaAuthSession().businessId;
  if (!businessId) throw new Error("Selecciona el negocio antes de devolver.");
  const remoteSaleId = await resolveRemoteSaleId(businessId, saleRef);
  try {
    if (!remoteSaleId) throw new NetworkError("La venta todavía no está en el servidor.");
    const remote = await getPwaApi().sales.createReturn(remoteSaleId, { lines }, requestId);
    await applyReturnStockOnce(businessId, requestId, remote.lines);
    const db = getLocalDb();
    await db.transaction("rw", [db.saleReturns, db.saleReturnLines], async () => {
      await putReturnRows(businessId, saleRef, requestId, remote);
    });
    return { mode: "online", returnId: remote.id };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const operationId = await enqueueReturn(businessId, saleRef, lines, requestId);
    return { mode: "offline", operationId };
  }
}

export async function syncPendingReturns(businessId: string) {
  return getOutboxSyncEngine().flush(
    businessId,
    async (item) => {
      if (item.entity !== "saleReturn" || item.operation !== "return") {
        throw new Error("Operación de outbox no compatible con devolución.");
      }
      const payload = readPayload(item);
      if (!payload) throw new Error("La devolución no tiene líneas.");
      const remoteSaleId = await resolveRemoteSaleId(businessId, payload.saleRef);
      if (!remoteSaleId) throw new Error("La venta todavía no tiene id remoto.");
      const remote = await getPwaApi().sales.createReturn(
        remoteSaleId,
        { lines: payload.lines },
        item.requestId,
      );
      await applyReturnStockOnce(businessId, item.requestId, remote.lines);
      const db = getLocalDb();
      await db.transaction("rw", [db.saleReturns, db.saleReturnLines], async () => {
        await putReturnRows(businessId, payload.saleRef, item.requestId, remote);
      });
      await reconcileReturnCustomer(businessId, payload.saleRef);
      return { remoteId: remote.id };
    },
    (item) => item.entity === "saleReturn" && item.operation === "return",
  );
}
