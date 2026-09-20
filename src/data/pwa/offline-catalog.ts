import { NetworkError } from "@/data/errors";
import type { RemoteCustomer, RemoteSupplier } from "@/data/http/mappers";
import { getPwaApi } from "./api";
import { getLocalDb } from "@/data/local/db";
import { getLocalStore } from "@/data/local/store";
import { ConnectivityMonitor, getOutboxStore, getOutboxSyncEngine } from "@/data/local/outbox";
import { assertUuid } from "@/data/local/ids";
import { customerToLocal, supplierToLocal } from "@/data/local/read-cache";

export type CustomerInput = { name: string; phone?: string };
export type SupplierInput = { name: string; phone?: string; notes?: string };

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
      const payload = item.payload as { name: string; phone?: string };
      const remote = await api.customers.create(payload, item.requestId);
      return { remoteId: remote.id };
    },
    (item) => item.entity === "customer" && item.operation === "create",
  );

  for (const operationId of operationIds) {
    const item = await outbox.get(businessId, operationId);
    if (!item || item.status !== "synced" || !item.remoteId) continue;
    const rows = await getLocalStore().customers.list(businessId);
    const local = rows.find((row) => row.requestId === item.requestId);
    if (local) {
      await reconcileCustomer(
        businessId,
        local.id,
        await api.customers.get(item.remoteId),
      );
    }
  }
  return result;
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
      const payload = item.payload as {
        name: string;
        phone?: string;
        notes?: string;
      };
      const remote = await api.suppliers.create(payload, item.requestId);
      return { remoteId: remote.id };
    },
    (item) => item.entity === "supplier" && item.operation === "create",
  );

  for (const operationId of operationIds) {
    const item = await outbox.get(businessId, operationId);
    if (!item || item.status !== "synced" || !item.remoteId) continue;
    const rows = await getLocalStore().suppliers.list(businessId);
    const local = rows.find((row) => row.requestId === item.requestId);
    if (local) {
      await reconcileSupplier(
        businessId,
        local.id,
        await api.suppliers.get(item.remoteId),
      );
    }
  }
  return result;
}

export function startCatalogCreationSync() {
  const monitor = new ConnectivityMonitor();
  const run = async () => {
    const id = getPwaApi().session.businessId;
    if (!id) return;
    await syncPendingCustomers(id);
    await syncPendingSuppliers(id);
  };
  monitor.subscribe((online) => { if (online) run(); });
  monitor.start();
  if (monitor.online) run();
  return () => monitor.stop();
}
