import { NetworkError } from "../errors";
import type { RemotePayment } from "../http/mappers";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";
import { ConnectivityMonitor, getOutboxSyncEngine } from "../local/outbox";
import { PENDING_CUSTOMER_MESSAGE } from "./offline-catalog";
import { newEntityId } from "../local/ids";
import { subCop } from "@/domain/money";
import type { PaymentTarget } from "../http/repository";

export type CreatePaymentInput = {
  customerId: string;
  amount: number;
  method: "Efectivo" | "Nequi";
  note?: string;
  /** C04 — omitted = oldest first. */
  target?: PaymentTarget;
  overflow?: "fifo" | "credit";
  /**
   * C04 — outbox op of a still-local sale this abono targets
   * (`target.saleRequestId`). The abono waits for it (dependsOn).
   */
  dependsOnOperationId?: string;
};

/**
 * C04 R4 — local estimate: how much of an abono lowers the cached debt and
 * how much becomes saldo a favor. The server decides on sync (T20).
 */
export function projectPaymentSplit(amount: number, debt: number): { toDebt: number; toCredit: number } {
  const toDebt = Math.min(amount, Math.max(0, debt));
  return { toDebt, toCredit: amount - toDebt };
}

/** Debt part of a queued abono (payloads from before C04 have no split). */
export function paymentDebtPart(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const p = payload as { amount?: unknown; projectedToDebt?: unknown };
  if (typeof p.projectedToDebt === "number" && Number.isInteger(p.projectedToDebt)) return p.projectedToDebt;
  return typeof p.amount === "number" && Number.isInteger(p.amount) ? p.amount : 0;
}

/** Fields of a queued abono that go to the server (never local projections). */
export function paymentWireBody(payload: CreatePaymentInput & { occurredAt?: string }) {
  return {
    amount: payload.amount,
    method: payload.method,
    ...(payload.note ? { note: payload.note } : {}),
    ...(payload.occurredAt ? { occurredAt: payload.occurredAt } : {}),
    ...(payload.target && payload.target.mode !== "fifo" ? { target: payload.target } : {}),
    ...(payload.overflow && payload.overflow !== "fifo" ? { overflow: payload.overflow } : {}),
  };
}

export type CreatePaymentResult =
  | { mode: "online"; payment: RemotePayment }
  | { mode: "offline"; paymentId: string };

export function validateOfflinePayment(input: CreatePaymentInput, debt: number): void {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("El abono tiene que ser mayor a 0.");
  }
  // C04 R4 / T21 — amount > debt is allowed offline; the excess is shown as
  // the saldo a favor that will remain (estimate).
  void debt;
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
      if (customer.requestId) {
        const op = await db.outbox
          .where("[businessId+requestId]")
          .equals([businessId, customer.requestId])
          .first();
        if (op && op.status !== "synced") throw new Error(PENDING_CUSTOMER_MESSAGE);
      }
      validateOfflinePayment(input, customer.debt);
      const split = projectPaymentSplit(input.amount, customer.debt);

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
        occurredAt: now,
        createdAt: now,
      });

      await db.customers.put({
        ...customer,
        debt: subCop(customer.debt, split.toDebt),
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
          ...(input.target && input.target.mode !== "fifo" ? { target: input.target } : {}),
          ...(input.overflow && input.overflow !== "fifo" ? { overflow: input.overflow } : {}),
          // C01/C03 — the server keeps when the money was really received.
          occurredAt: new Date(now).toISOString(),
          // C04 — local estimate only (never sent): debt part vs saldo a favor.
          projectedToDebt: split.toDebt,
          projectedToCredit: split.toCredit,
        },
        // C04 — an abono to a still-local sale waits for that sale to sync.
        dependsOn: input.dependsOnOperationId ? [input.dependsOnOperationId] : [],
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
        paymentWireBody(input),
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

function paymentEffectApplied(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  return (payload as { optimisticApplied?: unknown }).optimisticApplied !== false;
}

async function setPaymentApplied(operationId: string, applied: boolean): Promise<void> {
  const db = getLocalDb();
  const op = await db.outbox.get(operationId);
  if (!op || !op.payload || typeof op.payload !== "object") return;
  await db.outbox.put({
    ...op,
    payload: { ...(op.payload as Record<string, unknown>), optimisticApplied: applied },
  });
}

async function ensurePaymentOptimistic(businessId: string, operationId: string): Promise<void> {
  const db = getLocalDb();
  const op = await db.outbox.get(operationId);
  if (!op || op.businessId !== businessId || paymentEffectApplied(op.payload)) return;
  const payment = await db.customerPayments.get(operationId);
  if (!payment || payment.businessId !== businessId) return;
  const customer = await db.customers.get(payment.customerId);
  if (customer && customer.businessId === businessId) {
    const next = subCop(customer.debt, paymentDebtPart(op.payload));
    await db.customers.put({
      ...customer,
      // C01 / DC-15 — exact delta, no clamp: a later revert must land on the true prior debt.
            debt: next,
      updatedAt: Date.now(),
    });
  }
  await db.cashMoves.put({
    id: newEntityId(),
    businessId,
    amount: payment.amount,
    direction: "in",
    method: payment.method,
    kind: "debt_collect",
    sessionId: null,
    refType: "customer_payment",
    refId: payment.id,
    requestId: op.requestId,
    note: payment.note,
    occurredOn: payment.occurredOn,
    createdAt: Date.now(),
  });
  await setPaymentApplied(operationId, true);
}

export async function syncPendingPayments(businessId: string) {
  return getOutboxSyncEngine().flush(
    businessId,
    async (item) => {
      if (item.entity !== "customerPayment" || item.operation !== "pay") {
        throw new Error("Operación de outbox no compatible con M6.6.");
      }
      await ensurePaymentOptimistic(businessId, item.operationId);
      const current = await getLocalDb().outbox.get(item.operationId);
      const payload = (current?.payload ?? item.payload) as CreatePaymentInput & { occurredAt?: string };
      try {
        return {
          remoteId: (
            await getPwaApi().customers.pay(
              payload.customerId,
              paymentWireBody(payload),
              item.requestId,
            )
          ).id,
        };
      } catch (error) {
        // C01 / DC-01 — a permanent rejection keeps the local record and its effect
        // («Rechazada») until the owner retries, corrects or discards it.
        throw error;
      }
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
