import { NetworkError } from "../errors";
import type { RemotePayment } from "../http/mappers";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { ConnectivityMonitor, getOutboxSyncEngine } from "../local/outbox";
import { newEntityId } from "../local/ids";
import { subCop } from "@/domain/money";

export type CreatePaymentInput = {
  customerId: string;
  amount: number;
  method: "Efectivo" | "Nequi";
  note?: string;
};

export type CreatePaymentResult =
  | { mode: "online"; payment: RemotePayment }
  | { mode: "offline"; paymentId: string };

export function validateOfflinePayment(input: CreatePaymentInput, debt: number): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("El abono tiene que ser mayor a 0.");
  }
  if (input.amount > debt) {
    throw new Error("El abono no puede ser mayor al saldo.");
  }
  if (input.method !== "Efectivo" && input.method !== "Nequi") {
    throw new Error("Elige Efectivo o Nequi.");
  }
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function createLocalPayment(
  input: CreatePaymentInput,
  businessId: string,
  requestId: string,
): Promise<string> {
  const db = getLocalDb();
  const now = Date.now();
  const occurredOn = todayLocal();

  return db.transaction(
    "rw",
    [db.customers, db.customerPayments, db.cashMoves, db.outbox],
    async () => {
      const existing = await db.outbox
        .where("[businessId+requestId]")
        .equals([businessId, requestId])
        .first();
      if (existing) return existing.operationId;

      const customer = await db.customers
        .where("[businessId+id]")
        .equals([businessId, input.customerId])
        .first();

      if (!customer) throw new Error("El cliente no está disponible sin conexión.");
      validateOfflinePayment(input, customer.debt);

      const paymentId = newEntityId();
      await db.customerPayments.put({
        id: paymentId,
        businessId,
        customerId: customer.id,
        amount: input.amount,
        method: input.method,
        saleId: null,
        requestId,
        note: input.note ?? null,
        occurredOn,
        createdAt: now,
      });

      await db.customers.put({
        ...customer,
        debt: subCop(customer.debt, input.amount),
        updatedAt: now,
      });

      await db.cashMoves.put({
        id: newEntityId(),
        businessId,
        amount: input.amount,
        direction: "in",
        method: input.method,
        kind: "debt_collect",
        sessionId: null,
        refType: "customer_payment",
        refId: paymentId,
        requestId,
        note: input.note ?? null,
        occurredOn,
        createdAt: now,
      });

      await db.outbox.put({
        operationId: paymentId,
        businessId,
        entity: "customerPayment",
        operation: "pay",
        requestId,
        payload: {
          customerId: input.customerId,
          amount: input.amount,
          method: input.method,
          ...(input.note ? { note: input.note } : {}),
        },
        dependsOn: [],
        localCreatedAt: now,
        status: "pending",
        remoteId: null,
        attempts: 0,
        lastError: null,
        nextAttemptAt: null,
      });

      return paymentId;
    },
  );
}

export async function createPaymentWithOfflineFallback(
  input: CreatePaymentInput,
  requestId: string,
): Promise<CreatePaymentResult> {
  try {
    return {
      mode: "online",
      payment: await getPwaApi().customers.pay(
        input.customerId,
        {
          amount: input.amount,
          method: input.method,
          ...(input.note ? { note: input.note } : {}),
        },
        requestId,
      ),
    };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const businessId = getPwaAuthSession().businessId;
    if (!businessId) throw new Error("Selecciona el negocio antes de registrar el abono.");
    const paymentId = await createLocalPayment(input, businessId, requestId);
    return { mode: "offline", paymentId };
  }
}

export async function syncPendingPayments(businessId: string) {
  return getOutboxSyncEngine().flush(
    businessId,
    async (item) => {
      if (item.entity !== "customerPayment" || item.operation !== "pay") {
        throw new Error("Operación de outbox no compatible con M6.6.");
      }
      const payload = item.payload as CreatePaymentInput;
      return {
        remoteId: (
          await getPwaApi().customers.pay(
            payload.customerId,
            {
              amount: payload.amount,
              method: payload.method,
              ...(payload.note ? { note: payload.note } : {}),
            },
            item.requestId,
          )
        ).id,
      };
    },
    (item) => item.entity === "customerPayment" && item.operation === "pay",
  );
}

let stopPaymentsSync: (() => void) | null = null;

export function startPaymentsSync(): () => void {
  if (stopPaymentsSync) return stopPaymentsSync;
  const monitor = new ConnectivityMonitor();
  const sync = () => {
    const businessId = getPwaAuthSession().businessId;
    if (businessId && monitor.online) void syncPendingPayments(businessId);
  };
  monitor.start();
  monitor.refresh();
  sync();
  const unsubscribe = monitor.subscribe((online) => {
    if (online) sync();
  });
  stopPaymentsSync = () => {
    unsubscribe();
    monitor.stop();
    stopPaymentsSync = null;
  };
  return stopPaymentsSync;
}
