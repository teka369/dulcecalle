import { assertUuid } from "../local/ids";
import { getLocalDb } from "../local/db";
import { getOutboxStore } from "../local/outbox";
import type { OutboxItem } from "../local/types";
import { getPwaAuthSession } from "../http/session";
import { formatCop } from "@/domain/money";

export type TrayItemStatus = "pending" | "in_flight" | "failed";

export type TrayItem = {
  operationId: string;
  entity: OutboxItem["entity"];
  operation: OutboxItem["operation"];
  status: TrayItemStatus;
  localCreatedAt: number;
  lastError: string | null;
  requestId: string;
  attempts: number;
  nextAttemptAt: number | null;
  dependsOn: string[];
  payload: unknown;
};

export type EnrichedTrayItem = TrayItem & {
  /** Permanent failure: needs attention, never auto-retried. */
  permanent: boolean;
  /** Retryable failure: the engine will retry automatically. */
  retryable: boolean;
  /** Unsatisfied dependency description, when blocked. */
  blockedBy: string | null;
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
  "customer:patch": "Edición de cliente",
  "supplier:create": "Proveedor nuevo",
  "supplier:patch": "Edición de proveedor",
  "product:patch": "Edición de producto",
  "product:archive": "Archivo de producto",
  "productImage:create": "Foto de producto",
  "productImage:patch": "Foto de producto",
  "productImage:remove": "Foto de producto",
  "preparation:create": "Preparación",
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
    attempts: row.attempts,
    nextAttemptAt: row.nextAttemptAt,
    dependsOn: [...row.dependsOn],
    payload: row.payload,
  };
}

export function isPermanentFailure(item: Pick<TrayItem, "status" | "nextAttemptAt">): boolean {
  return item.status === "failed" && item.nextAttemptAt == null;
}

export function isRetryableFailure(item: Pick<TrayItem, "status" | "nextAttemptAt">): boolean {
  return item.status === "failed" && item.nextAttemptAt != null;
}

/**
 * Technical transport noise → human wording. Server/validation messages
 * are already user-facing Spanish and pass through untouched.
 */
export function humanizeSyncError(message: string | null): string | null {
  if (!message) return null;
  const clean = message.replace(/^(TypeError|Error)\s*:\s*/i, "").trim();
  if (/failed to fetch|networkerror|load failed|network request failed|aborted|timeout|sin conexi.n/i.test(clean)) {
    return "Se perdió la conexión durante el envío. Se reintentará automáticamente.";
  }
  return clean || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asMoney(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function asQty(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Honest one-line summary derived from the operation's own payload.
 * Never recomputes business totals; returns null when the payload
 * cannot be interpreted, so the UI falls back to generic labels.
 */
export function describeOutboxDetail(item: Pick<TrayItem, "entity" | "operation" | "payload">): string | null {
  try {
    const payload = asRecord(item.payload);
    if (!payload) return null;
    const money = (v: unknown) => {
      const n = asMoney(v);
      return n == null ? null : formatCop(n);
    };
    if (item.entity === "sale" && item.operation === "create") {
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      const qty = lines.reduce((sum, l) => {
        const q = asQty(asRecord(l)?.qty);
        return q == null ? sum : sum + q;
      }, 0);
      const received = money(payload.amountReceived);
      const kind =
        payload.paymentKind === "credit" ? "Fiada" : payload.paymentKind === "partial" ? "Parcial" : "Pagada";
      const parts = [`${lines.length} producto${lines.length === 1 ? "" : "s"}`];
      if (qty > 0) parts.push(`${qty} uds`);
      parts.push(kind);
      if (received && payload.paymentKind !== "credit") parts.push(received);
      return parts.join(" · ");
    }
    if (item.entity === "customerPayment" && item.operation === "pay") {
      const amount = money(payload.amount);
      if (!amount) return null;
      const method = asText(payload.method);
      return method ? `${amount} · ${method}` : amount;
    }
    if (item.entity === "expense" && item.operation === "create") {
      const amount = money(payload.amount);
      if (!amount) return null;
      const category = asText(payload.category);
      return category ? `${category} · ${amount}` : amount;
    }
    if (item.entity === "cashMove" && item.operation === "create") {
      const amount = money(payload.amount);
      if (!amount) return null;
      const kind = payload.kind === "aporte" ? "Aporte" : payload.kind === "retiro" ? "Retiro" : null;
      const method = asText(payload.method);
      return [kind, amount, method].filter(Boolean).join(" · ") || null;
    }
    if (item.entity === "cashSession" && item.operation === "open") {
      const base = money(payload.openingFloat);
      return base ? `Base ${base}` : null;
    }
    if (item.entity === "cashSession" && item.operation === "close") {
      const counted = money(payload.countedEfectivo);
      return counted ? `Conteo ${counted}` : null;
    }
    if (item.entity === "stockMove" && item.operation === "surtir") {
      const qty = asQty(payload.qty);
      if (qty == null) return null;
      const total = money(payload.totalCost);
      return total && total !== formatCop(0) ? `${qty} uds · ${total}` : `${qty} uds`;
    }
    if (item.entity === "stockMove" && item.operation === "shrink") {
      const qty = asQty(payload.qty);
      if (qty == null) return null;
      const reason =
        payload.reason === "me_lo_comi" ? "Consumo" : payload.reason === "regalar" ? "Regalo" : payload.reason === "perdido" ? "Pérdida" : null;
      return reason ? `${qty} uds · ${reason}` : `${qty} uds`;
    }
    if ((item.entity === "customer" || item.entity === "supplier") && item.operation === "create") {
      return asText(payload.name);
    }
    if (item.entity === "productImage") {
      if (item.operation === "create") return "Subiendo foto";
      if (item.operation === "remove") return "Eliminando foto";
      return "Actualizando foto";
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * First unsatisfied dependency described in user terms, or null when the
 * operation is not blocked. Reads the same outbox rows the engine uses.
 */
export async function resolveBlockedReason(
  businessId: string,
  item: Pick<TrayItem, "dependsOn">,
): Promise<string | null> {
  const outbox = getOutboxStore();
  for (const dependencyId of item.dependsOn) {
    const dependency = await outbox.get(businessId, dependencyId);
    if (!dependency || dependency.status === "synced") continue;
    if (dependency.entity === "supplier") return "Esperando proveedor";
    if (dependency.entity === "cashSession") return "Esperando apertura de caja";
    if (dependency.entity === "customer") return "Esperando cliente";
    return "Esperando otra operación";
  }
  return null;
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

/**
 * Tray rows enriched for display: permanent/retryable flags plus the
 * resolved dependency description. Single helper so the center and the
 * /sincronizacion page render the same reality.
 */
export async function listEnrichedTray(businessId: string): Promise<EnrichedTrayItem[]> {
  const rows = await listTrayOperations(businessId);
  return Promise.all(
    rows.map(async (row) => ({
      ...row,
      permanent: isPermanentFailure(row),
      retryable: isRetryableFailure(row),
      blockedBy: await resolveBlockedReason(businessId, row),
    })),
  );
}
