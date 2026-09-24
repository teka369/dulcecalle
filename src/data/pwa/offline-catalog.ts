import { NetworkError } from "@/data/errors";
import type { RemoteCustomer, RemoteProduct, RemoteSupplier } from "@/data/http/mappers";
import { getPwaApi } from "./api";
import { getLocalDb } from "@/data/local/db";
import { getLocalStore } from "@/data/local/store";
import { ConnectivityMonitor, getOutboxStore, getOutboxSyncEngine } from "@/data/local/outbox";
import { assertUuid } from "@/data/local/ids";
import { customerToLocal, productToLocal, supplierToLocal } from "@/data/local/read-cache";
import { INVENTORY_ERRORS } from "@/domain/inventory";

export type CustomerInput = { name: string; phone?: string };
export type SupplierInput = { name: string; phone?: string; notes?: string };
export type ProductInput = {
  name: string;
  price: number;
  stock?: number;
  /** Unit cost as CreateProductDto.avgCost (server applies openingStoredAvgCost). */
  avgCost?: number;
  lowStockAt?: number;
  gifted?: boolean;
  sellable?: boolean;
};

/**
 * Mirror of backend openingStoredAvgCost (number COP).
 * Sellable: unit cost. Combo with stock: unit×stock lot pool. Combo empty: 0.
 */
export function openingStoredAvgCost(input: {
  sellable: boolean;
  stock: number;
  unitCost: number;
}): number {
  if (!input.sellable) {
    if (input.stock <= 0) return 0;
    return input.unitCost * input.stock;
  }
  return input.unitCost;
}

export const PENDING_CUSTOMER_MESSAGE =
  "Este cliente aún se está sincronizando. Podrás usarlo en cuanto termine la sincronización.";
export const PENDING_SUPPLIER_MESSAGE =
  "Este proveedor aún se está sincronizando. Podrás usarlo en cuanto termine la sincronización.";

export function validateCatalogName(name: string): string {
  const value = name.trim();
  if (!value) throw new Error("El nombre es obligatorio.");
  return value;
}

function businessId(): string {
  const id = getPwaApi().session.businessId;
  if (!id) throw new Error("Selecciona un negocio.");
  assertUuid(id, "businessId");
  return id;
}

function cleanOptional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function createLocalCustomer(input: CustomerInput, requestId: string): Promise<string> {
  const biz = businessId();
  const db = getLocalDb();
  const store = getLocalStore();
  const outbox = getOutboxStore();
  const existing = await outbox.getByRequestId(biz, requestId);
  if (existing) {
    if (existing.entity !== "customer" || existing.operation !== "create") {
      throw new Error("requestId already used");
    }
    if (existing.remoteId) return existing.remoteId;
    const rows = await store.customers.list(biz);
    const local = rows.find((row) => row.requestId === requestId);
    if (local) return local.id;
    throw new Error("local customer not found");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    id, businessId: biz, code: null, name: input.name.trim(),
    phone: cleanOptional(input.phone) ?? null, debt: 0, archivedAt: null,
    requestId, createdAt: now, updatedAt: now,
  };
  const payload = { name: row.name, ...(row.phone ? { phone: row.phone } : {}) };
  await db.transaction("rw", db.customers, db.outbox, db.cacheMeta, async () => {
    await store.customers.put(row);
    await outbox.enqueue({
      operationId: crypto.randomUUID(), businessId: biz, entity: "customer",
      operation: "create", requestId, payload, dependsOn: [], localCreatedAt: now,
    });
    await db.cacheMeta.put({ id: `${biz}::customers`, businessId: biz, resource: "customers", cachedAt: now });
  });
  return id;
}

async function createLocalSupplier(input: SupplierInput, requestId: string): Promise<string> {
  const biz = businessId();
  const db = getLocalDb();
  const store = getLocalStore();
  const outbox = getOutboxStore();
  const existing = await outbox.getByRequestId(biz, requestId);
  if (existing) {
    if (existing.entity !== "supplier" || existing.operation !== "create") {
      throw new Error("requestId already used");
    }
    if (existing.remoteId) return existing.remoteId;
    const rows = await store.suppliers.list(biz);
    const local = rows.find((row) => row.requestId === requestId);
    if (local) return local.id;
    throw new Error("local supplier not found");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = {
    id, businessId: biz, name: input.name.trim(),
    requestId,
    phone: cleanOptional(input.phone) ?? null,
    notes: cleanOptional(input.notes) ?? null, createdAt: now, updatedAt: now,
  };
  const payload = {
    name: row.name,
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.notes ? { notes: row.notes } : {}),
  };
  await db.transaction("rw", db.suppliers, db.outbox, db.cacheMeta, async () => {
    await store.suppliers.put(row);
    await outbox.enqueue({
      operationId: crypto.randomUUID(), businessId: biz, entity: "supplier",
      operation: "create", requestId, payload, dependsOn: [], localCreatedAt: now,
    });
    await db.cacheMeta.put({ id: `${biz}::suppliers`, businessId: biz, resource: "suppliers", cachedAt: now });
  });
  return id;
}

export async function createCustomerWithOfflineFallback(input: CustomerInput, requestId: string) {
  const name = validateCatalogName(input.name);
  const normalized = { name, phone: cleanOptional(input.phone) };
  try {
    const customer = await getPwaApi().customers.create(normalized, requestId);
    return { mode: "online" as const, customer };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const id = await createLocalCustomer(normalized, requestId);
    return { mode: "offline" as const, customerId: id };
  }
}

export async function createSupplierWithOfflineFallback(input: SupplierInput, requestId: string) {
  const name = validateCatalogName(input.name);
  const normalized = {
    name, phone: cleanOptional(input.phone), notes: cleanOptional(input.notes),
  };
  try {
    const supplier = await getPwaApi().suppliers.create(normalized, requestId);
    return { mode: "online" as const, supplier };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const id = await createLocalSupplier(normalized, requestId);
    return { mode: "offline" as const, supplierId: id };
  }
}

function normalizeProductInput(input: ProductInput): Required<
  Pick<ProductInput, "name" | "price" | "stock" | "avgCost" | "lowStockAt" | "gifted" | "sellable">
> {
  const name = validateCatalogName(input.name);
  const price = input.price;
  if (!Number.isInteger(price) || price < 0) {
    throw new Error(INVENTORY_ERRORS.badCost);
  }
  const stock = input.stock ?? 0;
  if (!Number.isInteger(stock) || stock < 0) {
    throw new Error(INVENTORY_ERRORS.notPositive);
  }
  const gifted = Boolean(input.gifted);
  const unitCost = gifted ? 0 : (input.avgCost ?? 0);
  if (!Number.isInteger(unitCost) || unitCost < 0) {
    throw new Error(INVENTORY_ERRORS.badCost);
  }
  const sellable = input.sellable ?? true;
  const storedAvg = openingStoredAvgCost({ sellable, stock, unitCost });
  if (stock > 0 && storedAvg <= 0 && !gifted) {
    throw new Error(INVENTORY_ERRORS.needCost);
  }
  const lowStockAt = input.lowStockAt ?? 5;
  if (!Number.isInteger(lowStockAt) || lowStockAt < 0) {
    throw new Error("El aviso de stock no es válido.");
  }
  return {
    name,
    price,
    stock,
    avgCost: unitCost,
    lowStockAt,
    gifted,
    sellable,
  };
}

/** Whitelist-only CreateProductDto body (no id / productId / kind). */
function productCreatePayload(
  normalized: ReturnType<typeof normalizeProductInput>,
): Record<string, unknown> {
  return {
    name: normalized.name,
    price: normalized.price,
    stock: normalized.stock,
    avgCost: normalized.avgCost,
    lowStockAt: normalized.lowStockAt,
    gifted: normalized.gifted,
    sellable: normalized.sellable,
  };
}

async function createLocalProduct(
  input: ReturnType<typeof normalizeProductInput>,
  requestId: string,
): Promise<string> {
  const biz = businessId();
  const db = getLocalDb();
  const store = getLocalStore();
  const outbox = getOutboxStore();
  const existing = await outbox.getByRequestId(biz, requestId);
  if (existing) {
    if (existing.entity !== "product" || existing.operation !== "create") {
      throw new Error("requestId already used");
    }
    if (existing.remoteId) return existing.remoteId;
    const rows = await store.products.list(biz);
    const local = rows.find((row) => row.requestId === requestId);
    if (local) return local.id;
    throw new Error("local product not found");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const sellable = input.sellable;
  const row = {
    id,
    businessId: biz,
    name: input.name,
    category: "General",
    price: input.price,
    avgCost: openingStoredAvgCost({
      sellable,
      stock: input.stock,
      unitCost: input.avgCost,
    }),
    stock: input.stock,
    lowStockAt: input.lowStockAt,
    sellable,
    archivedAt: null,
    requestId,
    createdAt: now,
    updatedAt: now,
    images: [] as [],
  };
  const payload = productCreatePayload(input);
  await db.transaction("rw", db.products, db.outbox, db.cacheMeta, async () => {
    await store.products.put(row);
    await outbox.enqueue({
      operationId: crypto.randomUUID(),
      businessId: biz,
      entity: "product",
      operation: "create",
      requestId,
      payload,
      dependsOn: [],
      localCreatedAt: now,
    });
    await db.cacheMeta.put({
      id: `${biz}::products`,
      businessId: biz,
      resource: "products",
      cachedAt: now,
    });
  });
  return id;
}

export async function createProductWithOfflineFallback(
  input: ProductInput,
  requestId: string,
) {
  const normalized = normalizeProductInput(input);
  try {
    const product = await getPwaApi().products.create(
      productCreatePayload(normalized) as {
        name: string;
        price: number;
        stock?: number;
        avgCost?: number;
        lowStockAt?: number;
        gifted?: boolean;
        sellable?: boolean;
      },
      requestId,
    );
    return { mode: "online" as const, product };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const id = await createLocalProduct(normalized, requestId);
    return { mode: "offline" as const, productId: id };
  }
}

async function reconcileCustomer(businessId: string, localId: string, remote: RemoteCustomer) {
  const db = getLocalDb();
  await db.transaction("rw", db.customers, async () => {
    const local = await getLocalStore().customers.get(businessId, localId);
    if (local && local.id !== remote.id) await db.customers.delete(local.id);
    await getLocalStore().customers.put(customerToLocal(remote, businessId, Date.now()));
  });
}

async function reconcileSupplier(businessId: string, localId: string, remote: RemoteSupplier) {
  const db = getLocalDb();
  await db.transaction("rw", db.suppliers, async () => {
    const local = await getLocalStore().suppliers.get(businessId, localId);
    if (local && local.id !== remote.id) await db.suppliers.delete(local.id);
    await getLocalStore().suppliers.put(supplierToLocal(remote, businessId, Date.now()));
  });
}

/** Remap local product UUID → server UUID and rewrite pending FK refs. */
async function reconcileProduct(businessId: string, localId: string, remote: RemoteProduct) {
  const db = getLocalDb();
  await db.transaction(
    "rw",
    db.products,
    db.pendingMedia,
    db.outbox,
    async () => {
      const local = await getLocalStore().products.get(businessId, localId);
      if (local && local.id !== remote.id) {
        const media = await db.pendingMedia
          .where("[businessId+productId]")
          .equals([businessId, localId])
          .toArray();
        for (const row of media) {
          await db.pendingMedia.delete(row.id);
          await db.pendingMedia.put({ ...row, productId: remote.id });
        }
        const ops = await db.outbox.where("businessId").equals(businessId).toArray();
        for (const op of ops) {
          if (op.status === "synced") continue;
          const payload = op.payload;
          if (!payload || typeof payload !== "object") continue;
          const next = { ...(payload as Record<string, unknown>) };
          let changed = false;
          if (next.productId === localId) {
            next.productId = remote.id;
            changed = true;
          }
          if (op.entity === "product" && next.id === localId) {
            next.id = remote.id;
            changed = true;
          }
          if (changed) await db.outbox.put({ ...op, payload: next });
        }
        await db.products.delete(local.id);
      }
      await getLocalStore().products.put(productToLocal(remote, businessId, Date.now()));
    },
  );
}

export async function syncPendingCustomers(businessId: string) {
  const api = getPwaApi();
  const outbox = getOutboxStore();
  const engine = getOutboxSyncEngine();
  const candidates = await outbox.listByStatus(businessId, "pending");
  const operationIds = candidates
    .filter((item) => item.entity === "customer" && item.operation === "create")
    .map((item) => item.operationId);

  const result = await engine.flush(
    businessId,
    async (item) => {
      if (item.entity === "customer" && item.operation === "create") {
        const payload = item.payload as { name: string; phone?: string };
        const remote = await api.customers.create(payload, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "customer" && item.operation === "patch") {
        const payload = item.payload as { id: string; name?: string; phone?: string };
        const remote = await api.customers.patch(payload.id, payload, item.requestId);
        return { remoteId: remote.id };
      }
      throw new Error("Operación de outbox no compatible con clientes.");
    },
    (item) => item.entity === "customer" && (item.operation === "create" || item.operation === "patch"),
  );

  for (const operationId of operationIds) {
    const item = await outbox.get(businessId, operationId);
    if (!item || item.status !== "synced" || !item.remoteId) continue;
    // D4 — A failed post-flush GET must not abort the whole cycle nor
    // strand the local row: it is retried on the next cycle.
    try {
      const rows = await getLocalStore().customers.list(businessId);
      const local = rows.find((row) => row.requestId === item.requestId);
      if (local) {
        await reconcileCustomer(
          businessId,
          local.id,
          await api.customers.get(item.remoteId),
        );
      }
    } catch {
      /* keep the local row; reconcile again next cycle */
    }
  }
  await reconcileStrandedCustomers(businessId, api);
  return result;
}

/**
 * D4 — Recover rows stranded by an earlier failed reconcile: any local row
 * whose requestId already maps to a synced operation is reconciled, even
 * when its operation was never in this flush's pending snapshot.
 */
async function reconcileStrandedCustomers(
  businessId: string,
  api: ReturnType<typeof getPwaApi>,
): Promise<void> {
  const outbox = getOutboxStore();
  const rows = await getLocalStore().customers.list(businessId);
  for (const row of rows) {
    if (!row.requestId) continue;
    try {
      const item = await outbox.getByRequestId(businessId, row.requestId);
      if (item?.entity !== "customer" || item.operation !== "create") continue;
      if (item.status !== "synced" || !item.remoteId) continue;
      await reconcileCustomer(
        businessId,
        row.id,
        await api.customers.get(item.remoteId),
      );
    } catch {
      /* keep the local row; reconcile again next cycle */
    }
  }
}

export async function syncPendingSuppliers(businessId: string) {
  const api = getPwaApi();
  const outbox = getOutboxStore();
  const engine = getOutboxSyncEngine();
  const candidates = await outbox.listByStatus(businessId, "pending");
  const operationIds = candidates
    .filter((item) => item.entity === "supplier" && item.operation === "create")
    .map((item) => item.operationId);

  const result = await engine.flush(
    businessId,
    async (item) => {
      if (item.entity === "supplier" && item.operation === "create") {
        const payload = item.payload as {
          name: string;
          phone?: string;
          notes?: string;
        };
        const remote = await api.suppliers.create(payload, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "supplier" && item.operation === "patch") {
        const payload = item.payload as {
          id: string;
          name?: string;
          phone?: string;
          notes?: string;
        };
        const remote = await api.suppliers.patch(payload.id, payload, item.requestId);
        return { remoteId: remote.id };
      }
      throw new Error("Operación de outbox no compatible con proveedores.");
    },
    (item) => item.entity === "supplier" && (item.operation === "create" || item.operation === "patch"),
  );

  for (const operationId of operationIds) {
    const item = await outbox.get(businessId, operationId);
    if (!item || item.status !== "synced" || !item.remoteId) continue;
    // D4 — see syncPendingCustomers: never abort on a failed GET.
    try {
      const rows = await getLocalStore().suppliers.list(businessId);
      const local = rows.find((row) => row.requestId === item.requestId);
      if (local) {
        await reconcileSupplier(
          businessId,
          local.id,
          await api.suppliers.get(item.remoteId),
        );
      }
    } catch {
      /* keep the local row; reconcile again next cycle */
    }
  }
  await reconcileStrandedSuppliers(businessId, api);
  return result;
}

/** D4 — Supplier counterpart of reconcileStrandedCustomers. */
async function reconcileStrandedSuppliers(
  businessId: string,
  api: ReturnType<typeof getPwaApi>,
): Promise<void> {
  const outbox = getOutboxStore();
  const rows = await getLocalStore().suppliers.list(businessId);
  for (const row of rows) {
    if (!row.requestId) continue;
    try {
      const item = await outbox.getByRequestId(businessId, row.requestId);
      if (item?.entity !== "supplier" || item.operation !== "create") continue;
      if (item.status !== "synced" || !item.remoteId) continue;
      await reconcileSupplier(
        businessId,
        row.id,
        await api.suppliers.get(item.remoteId),
      );
    } catch {
      /* keep the local row; reconcile again next cycle */
    }
  }
}

export type CustomerPatchInput = { name?: string; phone?: string | null };
export type SupplierPatchInput = { name?: string; phone?: string | null; notes?: string | null };
export type ProductPatchInput = { name?: string; price?: number; lowStockAt?: number; sellable?: boolean };

export type PatchOfflineResult =
  | { mode: "online" }
  | { mode: "offline" };

function assertPatchName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const value = name.trim();
  if (!value) throw new Error("El nombre es obligatorio.");
  return value;
}

/** dependsOn the still-unsynced create operation of a locally-made row. */
async function createDependency(
  businessId: string,
  requestId: string | undefined,
  entity: "customer" | "supplier" | "product",
): Promise<string[]> {
  if (!requestId) return [];
  const item = await getOutboxStore().getByRequestId(businessId, requestId);
  if (item?.entity === entity && item.operation === "create" && item.status !== "synced") {
    return [item.operationId];
  }
  return [];
}

export async function patchCustomerWithOfflineFallback(
  id: string,
  input: CustomerPatchInput,
  requestId: string,
): Promise<PatchOfflineResult> {
  const name = assertPatchName(input.name);
  const normalized = {
    ...(name !== undefined ? { name } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
  };
  try {
    const remote = await getPwaApi().customers.patch(id, normalized, requestId);
    const biz = businessId();
    const local = await getLocalStore().customers.get(biz, id);
    if (local) {
      await getLocalStore().customers.put({ ...local, ...normalized, updatedAt: Date.now() });
    } else {
      await getLocalStore().customers.put(customerToLocal(remote, biz, Date.now()));
    }
    return { mode: "online" as const };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const biz = businessId();
    const db = getLocalDb();
    await db.transaction("rw", db.customers, db.outbox, async () => {
      const local = await getLocalStore().customers.get(biz, id);
      if (!local) throw new Error("El cliente no está disponible sin conexión.");
      await getLocalStore().customers.put({ ...local, ...normalized, updatedAt: Date.now() });
      await getOutboxStore().enqueue({
        operationId: crypto.randomUUID(),
        businessId: biz,
        entity: "customer",
        operation: "patch",
        requestId,
        payload: { id, ...normalized },
        dependsOn: await createDependency(biz, local.requestId, "customer"),
        localCreatedAt: Date.now(),
      });
    });
    return { mode: "offline" as const };
  }
}

export async function patchSupplierWithOfflineFallback(
  id: string,
  input: SupplierPatchInput,
  requestId: string,
): Promise<PatchOfflineResult> {
  const name = assertPatchName(input.name);
  const normalized = {
    ...(name !== undefined ? { name } : {}),
    ...(input.phone !== undefined ? { phone: input.phone } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
  try {
    const remote = await getPwaApi().suppliers.patch(id, normalized, requestId);
    const biz = businessId();
    const local = await getLocalStore().suppliers.get(biz, id);
    if (local) {
      await getLocalStore().suppliers.put({ ...local, ...normalized, updatedAt: Date.now() });
    } else {
      await getLocalStore().suppliers.put(supplierToLocal(remote, biz, Date.now()));
    }
    return { mode: "online" as const };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const biz = businessId();
    const db = getLocalDb();
    await db.transaction("rw", db.suppliers, db.outbox, async () => {
      const local = await getLocalStore().suppliers.get(biz, id);
      if (!local) throw new Error("El proveedor no está disponible sin conexión.");
      await getLocalStore().suppliers.put({ ...local, ...normalized, updatedAt: Date.now() });
      await getOutboxStore().enqueue({
        operationId: crypto.randomUUID(),
        businessId: biz,
        entity: "supplier",
        operation: "patch",
        requestId,
        payload: { id, ...normalized },
        dependsOn: await createDependency(biz, local.requestId, "supplier"),
        localCreatedAt: Date.now(),
      });
    });
    return { mode: "offline" as const };
  }
}

function assertProductPatch(input: ProductPatchInput): void {
  if (
    input.price !== undefined &&
    (!Number.isInteger(input.price) || input.price < 0)
  ) {
    throw new Error("El precio tiene que ser 0 o más.");
  }
  if (
    input.lowStockAt !== undefined &&
    (!Number.isInteger(input.lowStockAt) || input.lowStockAt < 0)
  ) {
    throw new Error("El aviso de stock no es válido.");
  }
}

export async function patchProductWithOfflineFallback(
  id: string,
  input: ProductPatchInput,
  requestId: string,
): Promise<PatchOfflineResult> {
  const name = assertPatchName(input.name);
  assertProductPatch(input);
  const normalized = {
    ...(name !== undefined ? { name } : {}),
    ...(input.price !== undefined ? { price: input.price } : {}),
    ...(input.lowStockAt !== undefined ? { lowStockAt: input.lowStockAt } : {}),
    ...(input.sellable !== undefined ? { sellable: input.sellable } : {}),
  };
  try {
    await getPwaApi().products.patch(id, normalized, requestId);
    const biz = businessId();
    const local = await getLocalStore().products.get(biz, id);
    if (local) {
      await getLocalStore().products.put({ ...local, ...normalized, updatedAt: Date.now() });
    }
    return { mode: "online" as const };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const biz = businessId();
    const db = getLocalDb();
    await db.transaction("rw", db.products, db.outbox, async () => {
      const local = await getLocalStore().products.get(biz, id);
      if (!local) throw new Error("El producto no está disponible sin conexión.");
      await getLocalStore().products.put({ ...local, ...normalized, updatedAt: Date.now() });
      await getOutboxStore().enqueue({
        operationId: crypto.randomUUID(),
        businessId: biz,
        entity: "product",
        operation: "patch",
        requestId,
        payload: { id, ...normalized },
        dependsOn: await createDependency(biz, local.requestId, "product"),
        localCreatedAt: Date.now(),
      });
    });
    return { mode: "offline" as const };
  }
}

export async function archiveProductWithOfflineFallback(
  id: string,
  requestId: string,
): Promise<PatchOfflineResult> {
  try {
    await getPwaApi().products.archive(id, requestId);
    const biz = businessId();
    const local = await getLocalStore().products.get(biz, id);
    if (local && !local.archivedAt) {
      await getLocalStore().products.put({
        ...local,
        archivedAt: new Date().toISOString(),
        updatedAt: Date.now(),
      });
    }
    return { mode: "online" as const };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const biz = businessId();
    const db = getLocalDb();
    await db.transaction("rw", db.products, db.outbox, async () => {
      const local = await getLocalStore().products.get(biz, id);
      if (!local) throw new Error("El producto no está disponible sin conexión.");
      if (!local.archivedAt) {
        await getLocalStore().products.put({
          ...local,
          archivedAt: new Date().toISOString(),
          updatedAt: Date.now(),
        });
      }
      await getOutboxStore().enqueue({
        operationId: crypto.randomUUID(),
        businessId: biz,
        entity: "product",
        operation: "archive",
        requestId,
        payload: { id },
        dependsOn: await createDependency(biz, local.requestId, "product"),
        localCreatedAt: Date.now(),
      });
    });
    return { mode: "offline" as const };
  }
}

async function resolveProductEntityId(
  businessId: string,
  item: { dependsOn: string[]; payload: unknown },
  fallbackId: string,
): Promise<string> {
  for (const depId of item.dependsOn) {
    const dep = await getOutboxStore().get(businessId, depId);
    if (
      dep?.entity === "product" &&
      dep.operation === "create" &&
      dep.status === "synced" &&
      dep.remoteId
    ) {
      return dep.remoteId;
    }
  }
  return fallbackId;
}

export async function syncPendingProducts(businessId: string) {
  const api = getPwaApi();
  const outbox = getOutboxStore();
  const engine = getOutboxSyncEngine();
  const candidates = await outbox.listByStatus(businessId, "pending");
  const operationIds = candidates
    .filter((item) => item.entity === "product" && item.operation === "create")
    .map((item) => item.operationId);

  const result = await engine.flush(
    businessId,
    async (item) => {
      if (item.entity === "product" && item.operation === "create") {
        const payload = item.payload as {
          name: string;
          price: number;
          stock?: number;
          avgCost?: number;
          lowStockAt?: number;
          gifted?: boolean;
          sellable?: boolean;
        };
        const remote = await api.products.create(payload, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "product" && item.operation === "patch") {
        const payload = item.payload as {
          id: string;
          name?: string;
          price?: number;
          lowStockAt?: number;
          sellable?: boolean;
        };
        const id = await resolveProductEntityId(businessId, item, payload.id);
        const remote = await api.products.patch(id, payload, item.requestId);
        return { remoteId: remote.id };
      }
      if (item.entity === "product" && item.operation === "archive") {
        const payload = item.payload as { id: string };
        const id = await resolveProductEntityId(businessId, item, payload.id);
        const remote = await api.products.archive(id, item.requestId);
        return { remoteId: remote.id };
      }
      throw new Error("Operación de outbox no compatible con productos.");
    },
    (item) =>
      item.entity === "product" &&
      (item.operation === "create" ||
        item.operation === "patch" ||
        item.operation === "archive"),
  );

  for (const operationId of operationIds) {
    const item = await outbox.get(businessId, operationId);
    if (!item || item.status !== "synced" || !item.remoteId) continue;
    try {
      const rows = await getLocalStore().products.list(businessId);
      const local = rows.find((row) => row.requestId === item.requestId);
      if (local) {
        await reconcileProduct(
          businessId,
          local.id,
          await api.products.get(item.remoteId),
        );
      }
    } catch {
      /* keep the local row; reconcile again next cycle */
    }
  }
  await reconcileStrandedProducts(businessId, api);
  return result;
}

async function reconcileStrandedProducts(
  businessId: string,
  api: ReturnType<typeof getPwaApi>,
): Promise<void> {
  const outbox = getOutboxStore();
  const rows = await getLocalStore().products.list(businessId);
  for (const row of rows) {
    if (!row.requestId) continue;
    try {
      const item = await outbox.getByRequestId(businessId, row.requestId);
      if (item?.entity !== "product" || item.operation !== "create") continue;
      if (item.status !== "synced" || !item.remoteId) continue;
      await reconcileProduct(
        businessId,
        row.id,
        await api.products.get(item.remoteId),
      );
    } catch {
      /* keep the local row; reconcile again next cycle */
    }
  }
}

export function startCatalogCreationSync() {
  const monitor = new ConnectivityMonitor();
  const run = async () => {
    const id = getPwaApi().session.businessId;
    if (!id) return;
    await syncPendingCustomers(id);
    await syncPendingSuppliers(id);
    await syncPendingProducts(id);
  };
  monitor.subscribe((online) => { if (online) run(); });
  monitor.start();
  if (monitor.online) run();
  return () => monitor.stop();
}

/**
 * D3 — Local ids of customers/suppliers whose create operation is still
 * not synced. While an entity is in this set it is visible and editable,
 * but it must not be used as a reference (credit sale, payment, surtir)
 * because the server does not know its local UUID yet.
 */
async function pendingCreateIds(
  businessId: string,
  entity: "customer" | "supplier",
): Promise<string[]> {
  assertUuid(businessId, "businessId");
  const db = getLocalDb();
  const pendingRequestIds = new Set<string>();
  for (const status of ["pending", "failed", "in_flight"] as const) {
    const rows = await db.outbox
      .where("[businessId+status]")
      .equals([businessId, status])
      .toArray();
    for (const row of rows) {
      if (row.entity === entity && row.operation === "create") {
        pendingRequestIds.add(row.requestId);
      }
    }
  }
  if (pendingRequestIds.size === 0) return [];
  const store = getLocalStore();
  const rows =
    entity === "customer"
      ? await store.customers.list(businessId)
      : await store.suppliers.list(businessId);
  return rows
    .filter((row) => row.requestId && pendingRequestIds.has(row.requestId))
    .map((row) => row.id);
}

export function listPendingCustomerIds(businessId: string): Promise<string[]> {
  return pendingCreateIds(businessId, "customer");
}

export function listPendingSupplierIds(businessId: string): Promise<string[]> {
  return pendingCreateIds(businessId, "supplier");
}

/** UI-friendly variants: empty when there is no active business. */
export async function getPendingCustomerIds(): Promise<string[]> {
  try {
    return await listPendingCustomerIds(businessId());
  } catch {
    return [];
  }
}

export async function getPendingSupplierIds(): Promise<string[]> {
  try {
    return await listPendingSupplierIds(businessId());
  } catch {
    return [];
  }
}
