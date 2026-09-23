import { NetworkError } from "../errors";
import type { RemotePreparation } from "../http/mappers";
import { getPwaApi } from "./api";
import { getPwaAuthSession } from "../http/session";
import { assertUuid } from "../local/ids";
import { getLocalDb } from "../local/db";
import { getOutboxStore, getOutboxSyncEngine } from "../local/outbox";
import { newEntityId } from "@/domain/requestId";
import { INVENTORY_ERRORS } from "@/domain/inventory/validate";
import {
  clean,
  ensureOpenDayEditable,
  openDependency,
  roundedAvg,
  todayLocal,
} from "./offline-operations";

function businessId(): string {
  const id = getPwaAuthSession().businessId;
  if (!id) throw new Error("Selecciona un negocio.");
  assertUuid(id, "businessId");
  return id;
}

export type PrepareInput = {
  sourceId: string;
  targetId: string;
  qty: number;
  /** null = pending: target average untouched, nothing transferred. */
  unitCost: number | null;
  note?: string;
};

/**
 * Preparation (Producción) offline-first, mirroring surtirWithOfflineFallback.
 *
 * Online: single POST /preparations (server transaction does everything).
 * Offline: one local Dexie transaction applies target stock/avg (same
 * roundedAvg as the server), writes the preparation row + both trace moves,
 * and enqueues one `preparation:create` outbox op. No cash moves: money left
 * at purchase time. The source lot is NOT decremented (unknown total yield);
 * the preparation row is the consumption trace.
 *
 * Local preparation rows are pending-only: the sync sender deletes the row
 * whose requestId was just registered, so history never duplicates. History
 * UI reads the server when online, Dexie when offline.
 */
export async function prepararWithOfflineFallback(
  input: PrepareInput,
  requestId: string,
): Promise<{ mode: "online"; value: RemotePreparation } | { mode: "offline"; id: string }> {
  assertUuid(input.sourceId, "sourceId");
  assertUuid(input.targetId, "targetId");
  assertUuid(requestId, "requestId");
  if (input.sourceId === input.targetId) {
    throw new Error(INVENTORY_ERRORS.sameProduct);
  }
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    throw new Error(INVENTORY_ERRORS.notPositive);
  }
  if (input.unitCost !== null && (!Number.isInteger(input.unitCost) || input.unitCost < 0)) {
    throw new Error(INVENTORY_ERRORS.badCost);
  }
  try {
    return {
      mode: "online" as const,
      value: await getPwaApi().production.prepare(
        {
          sourceId: input.sourceId,
          targetId: input.targetId,
          qty: input.qty,
          unitCost: input.unitCost,
          note: clean(input.note),
        },
        requestId,
      ),
    };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const business = businessId();
    const db = getLocalDb();
    const now = Date.now();
    await ensureOpenDayEditable(business);
    const source = await db.products
      .where("[businessId+id]")
      .equals([business, input.sourceId])
      .first();
    const target = await db.products
      .where("[businessId+id]")
      .equals([business, input.targetId])
      .first();
    if (!source || !target) {
      throw new Error("Los productos no están disponibles sin conexión.");
    }
    if (source.archivedAt || target.archivedAt) {
      throw new Error("Hay un producto archivado en la preparación.");
    }
    if (source.stock <= 0) {
      throw new Error(INVENTORY_ERRORS.noMaterial);
    }
    const dependsOn = await openDependency(db, business);
    const preparationId = newEntityId();
    const note = clean(input.note) ?? null;
    // Same value-conservation rule as the server: assigned cost transfers
    // from the lot (clamped at zero); pending transfers nothing and leaves
    // the finished average untouched.
    const assignedTotal = (input.unitCost ?? 0) * input.qty;
    const transfer = Math.min(assignedTotal, source.avgCost);
    await db.transaction(
      "rw",
      [db.products, db.preparations, db.stockMoves, db.outbox],
      async () => {
        await db.products.put({
          ...target,
          stock: target.stock + input.qty,
          avgCost:
            input.unitCost === null
              ? target.avgCost
              : roundedAvg(target.stock, target.avgCost, input.qty, input.unitCost),
          updatedAt: now,
        });
        await db.products.put({
          ...source,
          avgCost: source.avgCost - transfer,
          updatedAt: now,
        });
        await db.preparations.put({
          id: preparationId,
          businessId: business,
          sourceId: source.id,
          sourceName: source.name,
          targetId: target.id,
          targetName: target.name,
          qty: input.qty,
          unitCost: input.unitCost,
          note,
          requestId,
          occurredOn: todayLocal(),
          createdAt: now,
        });
        await db.stockMoves.put({
          id: newEntityId(),
          businessId: business,
          productId: target.id,
          delta: input.qty,
          reason: "preparacion",
          unitCost: input.unitCost ?? 0,
          supplierId: null,
          refType: "preparation",
          refId: preparationId,
          note: input.unitCost === null ? `Costo pendiente. ${note ?? ""}`.trim() || null : note,
          requestId: null,
          occurredOn: todayLocal(),
          createdAt: now,
        });
        await db.stockMoves.put({
          id: newEntityId(),
          businessId: business,
          productId: source.id,
          delta: 0,
          reason: "preparacion",
          unitCost: 0,
          supplierId: null,
          refType: "preparation",
          refId: preparationId,
          note: `Preparación de ${input.qty} × ${target.name}. Asignados ${transfer}; restante ${source.avgCost - transfer}.`,
          requestId: null,
          occurredOn: todayLocal(),
          createdAt: now,
        });
        await getOutboxStore().enqueue({
          operationId: preparationId,
          businessId: business,
          entity: "preparation",
          operation: "create",
          requestId,
          payload: {
            sourceId: source.id,
            targetId: target.id,
            qty: input.qty,
            unitCost: input.unitCost,
            note,
          },
          dependsOn: [...new Set(dependsOn)],
          localCreatedAt: now,
        });
      },
    );
    return { mode: "offline" as const, id: preparationId };
  }
}

/**
 * Preparation history. Online: server (source of truth). Only a transport
 * failure serves the local pending rows; HTTP errors rethrow so a stale or
 * foreign list is never shown as truth.
 */
export async function listPreparationsWithOfflineFallback(filter?: {
  sourceId?: string;
  targetId?: string;
}): Promise<{ rows: RemotePreparation[]; source: "server" | "cache" }> {
  const api = getPwaApi();
  try {
    const rows = await api.production.list(filter);
    return { rows, source: "server" };
  } catch (error) {
    if (!(error instanceof NetworkError)) throw error;
    const business = businessId();
    const db = getLocalDb();
    let rows = await db.preparations.where("businessId").equals(business).toArray();
    if (filter?.sourceId) rows = rows.filter((r) => r.sourceId === filter.sourceId);
    if (filter?.targetId) rows = rows.filter((r) => r.targetId === filter.targetId);
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        targetId: r.targetId,
        sourceName: r.sourceName,
        targetName: r.targetName,
        qty: r.qty,
        unitCost: r.unitCost,
        note: r.note,
        occurredOn: r.occurredOn,
        createdAt: r.createdAt,
      })),
      source: "cache",
    };
  }
}

/** Sync sender: registers the pending preparation, then drops the local row. */
export async function syncPendingPreparations(business: string) {
  const api = getPwaApi();
  const engine = getOutboxSyncEngine();
  return engine.flush(
    business,
    async (item) => {
      if (item.entity !== "preparation" || item.operation !== "create") {
        throw new Error("Operación de outbox no compatible con preparaciones.");
      }
      const payload = item.payload as {
        sourceId: string;
        targetId: string;
        qty: number;
        unitCost: number | null;
        note?: string | null;
      };
      const remote = await api.production.prepare(
        {
          sourceId: payload.sourceId,
          targetId: payload.targetId,
          qty: payload.qty,
          unitCost: payload.unitCost,
          note: payload.note ?? undefined,
        },
        item.requestId,
      );
      // Pending-only mirror: the server row is now the source of truth.
      try {
        await getLocalDb().preparations.where({ requestId: item.requestId }).delete();
      } catch {
        /* history refresh heals on next fetch */
      }
      return { remoteId: remote.id };
    },
    (item) => item.entity === "preparation",
  );
}
