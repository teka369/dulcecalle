import { NetworkError } from "../errors";
import type { CreateSaleInput } from "../http/repository";
import type { RemoteSale } from "../http/mappers";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { getOutboxStore, getOutboxSyncEngine, ConnectivityMonitor } from "../local/outbox";
import { PENDING_CUSTOMER_MESSAGE } from "./offline-catalog";
import { newEntityId } from "../local/ids";
import { addCop, mulCop, subCop } from "@/domain/money";
import type { LocalCustomer, LocalProduct, LocalSale, LocalSaleLine, LocalStockMove, LocalCashMove } from "../local/types";

export type CreateSaleResult =
  | { mode: "online"; sale: RemoteSale }
  | { mode: "offline"; saleId: string };

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function paymentValues(input: CreateSaleInput, total: number) {
  const received = input.amountReceived;
  if (!Number.isInteger(received) || received < 0 || received > total) {
    throw new Error("El valor recibido no es válido.");
  }
  if (input.paymentKind === "paid" && received !== total) {
    throw new Error("La venta pagada debe recibirse completa.");
  }
  if (input.paymentKind === "credit" && received !== 0) {
    throw new Error("La venta fiada no recibe dinero.");
  }
  if (input.paymentKind === "partial" && (received <= 0 || received >= total)) {
    throw new Error("El abono debe ser mayor que 0 y menor que el total.");
  }
  if (received > 0 && input.method !== "Efectivo" && input.method !== "Nequi") {
    throw new Error("Elige Efectivo o Nequi.");
  }
  return { received, credit: subCop(total, received) };
}

async function createLocalSale(
  input: CreateSaleInput,
  businessId: string,
  requestId: string,
): Promise<string> {
  const db = getLocalDb();
  const now = Date.now();
  const occurredOn = todayLocal();

  return db.transaction(
    "rw",
    [
      db.products,
      db.customers,
      db.sales,
      db.saleLines,
      db.stockMoves,
      db.cashMoves,
      db.outbox,
    ],
    async () => {
      const existingOutbox = await db.outbox
        .where("[businessId+requestId]")
        .equals([businessId, requestId])
        .first();
      if (existingOutbox) return existingOutbox.operationId;

      if (!input.lines.length) throw new Error("Agrega al menos un producto.");

      const needsCustomer = input.paymentKind !== "paid";
      if (needsCustomer && !input.customerId) throw new Error("Selecciona un cliente.");

      const products = await db.products.where("businessId").equals(businessId).toArray();
      const customers = await db.customers.where("businessId").equals(businessId).toArray();
      const productById = new Map(products.map((p) => [p.id, p]));
      const customerById = new Map(customers.map((c) => [c.id, c]));

      if (needsCustomer && !customerById.has(input.customerId!)) {
        throw new Error("El cliente no está disponible sin conexión.");
      }

      let total = 0;
      const prepared: Array<{
        product: LocalProduct;
        qty: number;
        unitPrice: number;
        lineTotal: number;
      }> = [];

      for (const line of input.lines) {
        if (!Number.isInteger(line.qty) || line.qty <= 0) {
          throw new Error("La cantidad tiene que ser mayor a 0.");
        }
        const product = productById.get(line.productId);
        if (!product) throw new Error("El producto no está disponible sin conexión.");
        if (product.archivedAt) throw new Error(`El producto "${product.name}" está archivado.`);
        if (product.stock < line.qty) throw new Error(`Stock insuficiente para "${product.name}".`);
        const unitPrice = line.unitPrice ?? product.price;
        if (!Number.isInteger(unitPrice) || unitPrice < 0) {
          throw new Error("El precio tiene que ser 0 o más.");
        }
        const lineTotal = mulCop(unitPrice, line.qty);
        total = addCop(total, lineTotal);
        prepared.push({ product, qty: line.qty, unitPrice, lineTotal });
      }

      const { received, credit } = paymentValues(input, total);
      const saleId = newEntityId();

      const sale: LocalSale = {
        id: saleId,
        businessId,
        customerId: input.customerId ?? null,
        paymentKind: input.paymentKind,
        method: received > 0 ? input.method! : null,
        saleTotal: total,
        amountReceived: received,
        credit,
        requestId,
        note: input.note ?? null,
        occurredOn,
        createdAt: now,
        updatedAt: now,
      };
      await db.sales.put(sale);

      for (const row of prepared) {
        const line: LocalSaleLine = {
          id: newEntityId(),
          businessId,
          saleId,
          productId: row.product.id,
          productName: row.product.name,
          qty: row.qty,
          unitPrice: row.unitPrice,
          unitCost: row.product.avgCost,
          lineTotal: row.lineTotal,
          createdAt: now,
        };
        await db.saleLines.put(line);
        await db.products.put({ ...row.product, stock: row.product.stock - row.qty, updatedAt: now });
        const move: LocalStockMove = {
          id: newEntityId(),
          businessId,
          productId: row.product.id,
          delta: -row.qty,
          reason: "sale",
          unitCost: row.product.avgCost,
          supplierId: null,
          refType: "sale",
          refId: saleId,
          note: null,
          requestId,
          occurredOn,
          createdAt: now,
        };
        await db.stockMoves.put(move);
      }

      if (received > 0) {
        const move: LocalCashMove = {
          id: newEntityId(),
          businessId,
          amount: received,
          direction: "in",
          method: input.method!,
          kind: "sale",
          sessionId: null,
          refType: "sale",
          refId: saleId,
          requestId,
          note: input.note ?? null,
          occurredOn,
          createdAt: now,
        };
        await db.cashMoves.put(move);
      }

      if (credit > 0 && input.customerId) {
        const customer = customerById.get(input.customerId);
        if (!customer) throw new Error("El cliente no está disponible sin conexión.");
        if (customer.requestId) {
          const op = await db.outbox
            .where("[businessId+requestId]")
            .equals([businessId, customer.requestId])
            .first();
          if (op && op.status !== "synced") throw new Error(PENDING_CUSTOMER_MESSAGE);
        }
        const updated: LocalCustomer = {
          ...customer,
          debt: addCop(customer.debt, credit),
          updatedAt: now,
        };
        await db.customers.put(updated);
      }

      await db.outbox.put({
        operationId: saleId,
        businessId,
        entity: "sale",
        operation: "create",
        requestId,
        payload: input,
        dependsOn: [],
        localCreatedAt: now,
        status: "pending",
        remoteId: null,
        attempts: 0,
        lastError: null,
        nextAttemptAt: null,
      });

      return saleId;
    },
  );
}

export async function createSaleWithOfflineFallback(
  input: CreateSaleInput,
  requestId: string,
): Promise<CreateSaleResult> {
  try {
    return { mode: "online", sale: await getPwaApi().sales.create(input, requestId) };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const businessId = getPwaAuthSession().businessId;
    if (!businessId) throw new Error("Selecciona el negocio antes de vender.");
    const saleId = await createLocalSale(input, businessId, requestId);
    return { mode: "offline", saleId };
  }
}

export async function syncPendingSales(businessId: string) {
  return getOutboxSyncEngine().flush(businessId, async (item) => {
    if (item.entity !== "sale" || item.operation !== "create") {
      throw new Error("Operación de outbox no compatible con M6.5.");
    }
    return {
      remoteId: (await getPwaApi().sales.create(item.payload as CreateSaleInput, item.requestId)).id,
    };
  }, (item) => item.entity === "sale" && item.operation === "create");
}

let stopSalesSync: (() => void) | null = null;

export function startSalesSync(): () => void {
  if (stopSalesSync) return stopSalesSync;
  const monitor = new ConnectivityMonitor();
  const sync = () => {
    const businessId = getPwaAuthSession().businessId;
    if (businessId && monitor.online) void syncPendingSales(businessId);
  };
  monitor.start();
  monitor.refresh();
  sync();
  const unsubscribe = monitor.subscribe((online) => {
    if (online) sync();
  });
  stopSalesSync = () => {
    unsubscribe();
    monitor.stop();
    stopSalesSync = null;
  };
  return stopSalesSync;
}
