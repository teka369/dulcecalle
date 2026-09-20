import { assertUuid } from "../local/ids";
import { getLocalDb } from "../local/db";
import { getOutboxStore } from "../local/outbox";
import type { OutboxItem } from "../local/types";
import { getPwaAuthSession } from "../http/session";

export type TrayItemStatus = "pending" | "in_flight" | "failed";

export type TrayItem = {
  operationId: string;
  entity: OutboxItem["entity"];
  operation: OutboxItem["operation"];
  status: TrayItemStatus;
  localCreatedAt: number;
  lastError: string | null;
  requestId: string;
};

const OPERATION_NAMES: Record<string, string> = {
  "cashSession:open": "Apertura de caja",
  "cashSession:close": "Cierre de caja",
  "cashMove:create": "Movimiento de caja",
  "expense:create": "Gasto",
  "stockMove:surtir": "Surtido de inventario",
  "stockMove:shrink": "Salida de inventario",
  "sale:create": "Venta",
  "customerPayment:pay": "Abono de cliente",
  "customer:create": "Cliente nuevo",
  "supplier:create": "Proveedor nuevo",
};

export function describeOutboxOperation(
  entity: OutboxItem["entity"],
  operation: OutboxItem["operation"],
): string {
  return OPERATION_NAMES[`${entity}:${operation}`] ?? "Operación";
}

export function describeTrayStatus(status: TrayItemStatus): string {
  if (status === "failed") return "Error";
  if (status === "in_flight") return "Sincronizando";
  return "Pendiente";
}

function toTrayItem(row: OutboxItem): TrayItem {
  return {
    operationId: row.operationId,
    entity: row.entity,
    operation: row.operation,
    status: row.status as TrayItemStatus,
    localCreatedAt: row.localCreatedAt,
    lastError: row.lastError,
    requestId: row.requestId,
  };
}

/**
 * M6.9 — Sync tray reads. Lists actionable outbox rows (pending,
 * in_flight, failed) for one business, oldest first. Synced rows are
 * history and never listed.
 */
export async function listTrayOperations(
  businessId: string,
): Promise<TrayItem[]> {
  assertUuid(businessId, "businessId");
  const db = getLocalDb();
  const rows: OutboxItem[] = [];
  for (const status of ["pending", "in_flight", "failed"] as const) {
    rows.push(
      ...(await db.outbox
        .where("[businessId+status]")
        .equals([businessId, status])
        .toArray()),
    );
  }
  return rows
    .sort((a, b) => a.localCreatedAt - b.localCreatedAt)
    .map(toTrayItem);
}

/** M6.9 — Manual retry: failed → pending, same requestId, no new intent. */
export async function retryOutboxOperation(
  businessId: string,
  operationId: string,
): Promise<TrayItem> {
  const row = await getOutboxStore().requeue(businessId, operationId);
  return toTrayItem(row);
}

/**
 * M6.9 — Explicit discard of the local intent (pending/failed only).
 * Never reverts a server-side effect; the row is never sent again.
 */
export async function discardOutboxOperation(
  businessId: string,
  operationId: string,
): Promise<void> {
  await getOutboxStore().discard(businessId, operationId);
}

/** UI-friendly session resolution: empty when there is no business. */
export async function listTrayForSession(): Promise<TrayItem[]> {
  const businessId = getPwaAuthSession().businessId;
  if (!businessId) return [];
  return listTrayOperations(businessId);
}
