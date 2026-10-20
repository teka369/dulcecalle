import { assertUuid } from "../local/ids";
import { getLocalDb } from "../local/db";
import { getOutboxStore, payloadReferences } from "../local/outbox";
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
  discardedDependency?: OutboxItem["discardedDependency"];
};

export type EnrichedTrayItem = TrayItem & {
  /** Permanent failure: needs attention, never auto-retried. */
  permanent: boolean;
  /** Retryable failure: the engine will retry automatically. */
  retryable: boolean;
  /** Unsatisfied dependency description, when blocked. */
  blockedBy: string | null;
  /** Pending, but a dependency row no longer exists (it was discarded): actionable. */
  orphaned: boolean;
  /** Reintentar is offered only when a retry can actually work. */
  canRetry: boolean;
  /** Why only Descartar is offered (Spanish, user-facing), when it applies. */
  orphanNote: string | null;
};

export function orphanLocalNote(label: string): string {
  return `Dependía de «${label}», que se descartó y nunca llegó al servidor, así que no se puede enviar. Descártalo y vuelve a crearlo.`;
}
export const ORPHAN_LOCAL_UNKNOWN_PARENT_NOTE =
  "Dependía de una operación que se descartó y nunca llegó al servidor, así que no se puede enviar. Descártalo y vuelve a crearlo.";
export const ORPHAN_UNDETERMINED_NOTE =
  "Dependía de una operación que se descartó. No podemos confirmar si se puede enviar sin ella, así que por seguridad solo se puede descartar. Descártalo y vuelve a crearlo.";

export const ORPHAN_BLOCKED_REASON = "Esperando a una operación que se descartó";

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
  "product:create": "Producto nuevo",
  "product:archive": "Archivo de producto",
  "productImage:create": "Foto de producto",
  "productImage:patch": "Foto de producto",
  "productImage:remove": "Foto de producto",
  "preparation:create": "Preparación",
  "initialDebt:create": "Deuda inicial",
  "saleReturn:return": "Devolución",
};

export function describeOutboxOperation(entity: string, operation: string): string {
  return OPERATION_NAMES[`${entity}:${operation}`] ?? "Operación";
}

export function activityLabel(entity?: string, operation?: string): string {
  if (!entity) return "Operación";
  return describeOutboxOperation(entity, operation ?? "");
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
    ...(row.discardedDependency ? { discardedDependency: row.discardedDependency } : {}),
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
    // A missing row was discarded: it will never sync, so this waits forever.
    if (!dependency) return ORPHAN_BLOCKED_REASON;
    if (dependency.status === "synced") continue;
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

/**
 * M6.9 — Manual retry: failed → pending, same requestId, no new intent.
 * loop/v1 T-alto2: a pending orphan (its dependency was discarded) is
 * released from the missing dependency instead.
 */
export async function retryOutboxOperation(
  businessId: string,
  operationId: string,
): Promise<TrayItem> {
  const outbox = getOutboxStore();
  const current = await outbox.get(businessId, operationId);
  const row =
    current?.status === "pending"
      ? await outbox.detachMissingDependencies(businessId, operationId)
      : await outbox.requeue(businessId, operationId);
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
  const outbox = getOutboxStore();
  const parent = await outbox.get(businessId, operationId);
  const parentLabel = parent ? describeOutboxOperation(parent.entity, parent.operation) : "otra operación";
  await outbox.discard(businessId, operationId, {
    parentLabel,
    parentLocalIds: parent ? await localIdsFor(businessId, parent) : [],
    dependentReason: (_discarded, local) =>
      local
        ? orphanLocalNote(parentLabel)
        : `Esperando a ${parentLabel}, que se descartó. Reintenta para enviarlo sin eso, o descártalo.`,
  });
}

/**
 * Local ids an operation stands for: its operationId (sales, cash sessions
 * and moves use it as the local entity id) plus the local customer/supplier/
 * product/cash-session row created with the same requestId.
 */
async function localIdsFor(businessId: string, op: OutboxItem): Promise<string[]> {
  const ids = [op.operationId];
  const db = getLocalDb();
  const byRequest = async (table: "customers" | "suppliers" | "products" | "cashSessions") => {
    try {
      const rows = await db
        .table(table)
        .where("businessId")
        .equals(businessId)
        .filter((row: { requestId?: string | null }) => row.requestId === op.requestId)
        .toArray();
      for (const row of rows as Array<{ id?: string }>) if (row.id) ids.push(row.id);
    } catch {
      /* table/index unavailable: the operationId alone still counts */
    }
  };
  if (op.entity === "customer") await byRequest("customers");
  if (op.entity === "supplier") await byRequest("suppliers");
  if (op.entity === "product") await byRequest("products");
  if (op.entity === "cashSession") await byRequest("cashSessions");
  return ids;
}

/** UI-friendly session resolution: empty when there is no business. */
export async function listTrayForSession(): Promise<TrayItem[]> {
  const businessId = getPwaAuthSession().businessId;
  if (!businessId) return [];
  return listTrayOperations(businessId);
}

async function enrichBlocked(businessId: string, row: TrayItem & { discardedDependency?: OutboxItem["discardedDependency"] }) {
  const blockedBy = await resolveBlockedReason(businessId, row);
  const orphaned = row.status === "pending" && blockedBy === ORPHAN_BLOCKED_REASON;
  if (row.discardedDependency?.local) {
    return { blockedBy, orphaned, canRetry: false, orphanNote: orphanLocalNote(row.discardedDependency.label) };
  }
  if (orphaned) {
    // Legacy orphan: the parent row is gone, so we only know its id.
    const outbox = getOutboxStore();
    const missing: string[] = [];
    for (const id of row.dependsOn) if (!(await outbox.get(businessId, id))) missing.push(id);
    const note = payloadReferences(row.payload, missing) ? ORPHAN_LOCAL_UNKNOWN_PARENT_NOTE : ORPHAN_UNDETERMINED_NOTE;
    return { blockedBy, orphaned, canRetry: false, orphanNote: note };
  }
  return { blockedBy, orphaned, canRetry: true, orphanNote: null };
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
      ...(await enrichBlocked(businessId, row)),
    })),
  );
}
