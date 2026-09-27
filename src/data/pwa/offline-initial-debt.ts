import { NetworkError } from "../errors";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { getLocalStore } from "../local/store";
import { getOutboxStore, getOutboxSyncEngine } from "../local/outbox";
import { newEntityId } from "../local/ids";
import { customerToLocal } from "../local/read-cache";
import { pendingDebtAdjustment, isPermanentDebtRejection } from "./pending-debt";
import { addCop, subCop } from "@/domain/money";
import type { RemoteInitialDebt } from "../http/mappers";

export type CreateInitialDebtInput = {
  customerId: string;
  amount: number;
  note?: string;
};

export type CreateInitialDebtResult =
  | { mode: "online"; debt: RemoteInitialDebt }
  | { mode: "offline"; debtId: string };

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function customerDependency(
  businessId: string,
  customerId: string,
): Promise<string[]> {
  const customer = await getLocalStore().customers.get(businessId, customerId);
  if (!customer) return [];
  const requestId = customer.requestId;
  if (!requestId) return [];
  const op = await getOutboxStore().getByRequestId(businessId, requestId);
  if (op?.entity === "customer" && op.operation === "create" && op.status !== "synced") {
    return [op.operationId];
  }
  return [];
}

async function resolveRemoteCustomerId(
  businessId: string,
  customerId: string,
  dependsOn: string[] = [],
): Promise<string | null> {
  for (const depId of dependsOn) {
    const dep = await getOutboxStore().get(businessId, depId);
    if (dep?.entity !== "customer" || dep.operation !== "create") continue;
    if (dep.status !== "synced" || !dep.remoteId) return null;
    return dep.remoteId;
  }
  const direct = await getOutboxStore().get(businessId, customerId);
  if (direct?.entity === "customer" && direct.operation === "create") {
    if (direct.status !== "synced" || !direct.remoteId) return null;
    return direct.remoteId;
  }
  const customer = await getLocalStore().customers.get(businessId, customerId);
  if (!customer) return null;
  if (!customer.requestId) return customer.id;
  const op = await getOutboxStore().getByRequestId(businessId, customer.requestId);
  if (op?.entity === "customer" && op.operation === "create") {
    return op.status === "synced" && op.remoteId ? op.remoteId : null;
  }
  return customer.id;
}

async function createLocalInitialDebt(
  input: CreateInitialDebtInput,
  businessId: string,
  requestId: string,
): Promise<string> {
  const db = getLocalDb();
  const store = getLocalStore();
  const outbox = getOutboxStore();
  const now = Date.now();
  const occurredOn = todayLocal();

  return db.transaction("rw", [db.customers, db.initialDebts, db.outbox], async () => {
    const existing = await outbox.getByRequestId(businessId, requestId);
    if (existing) {
      if (existing.entity !== "initialDebt" || existing.operation !== "create") {
        throw new Error("requestId already used");
      }
      return existing.operationId;
    }

    const customer = await store.customers.get(businessId, input.customerId);
    if (!customer) throw new Error("El cliente no está disponible sin conexión.");

    const dependency = await customerDependency(businessId, input.customerId);

    const debtId = newEntityId();
    await db.initialDebts.put({
      id: debtId,
      businessId,
      customerId: customer.id,
      amount: input.amount,
      note: input.note ?? null,
      requestId,
      occurredOn,
      createdAt: now,
    });
    await db.customers.put({
      ...customer,
      debt: addCop(customer.debt, input.amount),
      updatedAt: now,
    });
    await outbox.enqueue({
      operationId: debtId,
      businessId,
      entity: "initialDebt",
      operation: "create",
      requestId,
      payload: {
        customerId: input.customerId,
        amount: input.amount,
        ...(input.note ? { note: input.note } : {}),
      },
      dependsOn: dependency,
      localCreatedAt: now,
    });
    return debtId;
  });
}

export async function createInitialDebtWithOfflineFallback(
  input: CreateInitialDebtInput,
  requestId: string,
): Promise<CreateInitialDebtResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("La deuda tiene que ser mayor a 0.");
  }
  const businessId = getPwaAuthSession().businessId;
  if (!businessId) throw new Error("Selecciona el negocio.");

  const remoteCustomerId = await resolveRemoteCustomerId(businessId, input.customerId);
  if (!remoteCustomerId) {
    const debtId = await createLocalInitialDebt(input, businessId, requestId);
    return { mode: "offline", debtId };
  }

  try {
    const debt = await getPwaApi().customers.initialDebt(
      remoteCustomerId,
      { amount: input.amount, ...(input.note ? { note: input.note } : {}) },
      requestId,
    );
    return { mode: "online", debt };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const debtId = await createLocalInitialDebt(input, businessId, requestId);
    return { mode: "offline", debtId };
  }
}

async function revertOptimisticInitialDebt(
  businessId: string,
  customerId: string,
  amount: number,
): Promise<void> {
  const customer = await getLocalStore().customers.get(businessId, customerId);
  if (!customer || amount <= 0) return;
  const next = subCop(customer.debt, amount);
  await getLocalStore().customers.put({
    ...customer,
    debt: next < 0 ? 0 : next,
    updatedAt: Date.now(),
  });
}

async function reconcileInitialDebt(
  businessId: string,
  operationId: string,
  remote: RemoteInitialDebt,
): Promise<void> {
  const db = getLocalDb();
  await db.transaction("rw", [db.initialDebts, db.customers], async () => {
    const local = await db.initialDebts.get(operationId);
    if (local) {
      await db.initialDebts.delete(operationId);
      await db.initialDebts.put({
        ...local,
        id: remote.id,
        customerId: remote.customerId,
        amount: remote.amount,
        note: remote.note,
        occurredOn: remote.occurredOn,
        createdAt: remote.createdAt,
      });
    }
  });
  try {
    const customer = await getPwaApi().customers.get(remote.customerId);
    const snapshot = customerToLocal(customer, businessId, Date.now());
    const pending = await pendingDebtAdjustment(businessId, remote.customerId, [operationId]);
    await getLocalStore().customers.put({
      ...snapshot,
      debt: addCop(snapshot.debt, pending),
    });
  } catch {
    // The outbox remains synced; a later customer refresh can reconcile the cache.
  }
}

export async function syncPendingInitialDebts(businessId: string) {
  const api = getPwaApi();
  const result = await getOutboxSyncEngine().flush(
    businessId,
    async (item) => {
      if (item.entity !== "initialDebt" || item.operation !== "create") {
        throw new Error("Operación de outbox no compatible con deuda inicial.");
      }
      const payload = item.payload as { customerId: string; amount: number; note?: string };
      const customerId = await resolveRemoteCustomerId(
        businessId,
        payload.customerId,
        item.dependsOn,
      );
      if (!customerId) throw new NetworkError("El cliente todavía no tiene id remoto.");
      try {
        const remote = await api.customers.initialDebt(
          customerId,
          { amount: payload.amount, ...(payload.note ? { note: payload.note } : {}) },
          item.requestId,
        );
        await reconcileInitialDebt(businessId, item.operationId, remote);
        return { remoteId: remote.id };
      } catch (error) {
        if (isPermanentDebtRejection(error)) {
          await revertOptimisticInitialDebt(businessId, customerId, payload.amount);
        }
        throw error;
      }
    },
    (item) => item.entity === "initialDebt" && item.operation === "create",
  );
  return result;
}

