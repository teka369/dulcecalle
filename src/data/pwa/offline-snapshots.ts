import { NetworkError } from "../errors";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import type { RemoteStats } from "../http/mappers";
import { getPwaApi } from "./api";
import { loadDashboardResult } from "./dashboard";
import { getPwaAuthSession } from "../http/session";
import { getLocalDb } from "../local/db";

export const DASHBOARD_SNAPSHOT_KIND = "dashboard";
export const statsSnapshotKind = (period: string): string => `stats:${period}`;

export type SnapshotResult<T> = {
  data: T;
  source: "server" | "cache";
  capturedAt: number;
};

function snapshotId(businessId: string, kind: string): string {
  return `${businessId}::${kind}`;
}

function requireBusinessId(): string {
  const businessId = getPwaAuthSession().businessId;
  if (!businessId) throw new Error("Selecciona un negocio.");
  return businessId;
}

async function loadWithSnapshot<T>(opts: {
  kind: string;
  fetch: () => Promise<T>;
  validate: (data: T) => boolean;
}): Promise<SnapshotResult<T>> {
  const businessId = requireBusinessId();
  const db = getLocalDb();
  try {
    const data = await opts.fetch();
    if (!opts.validate(data)) throw new Error("Respuesta inválida del servidor.");
    const capturedAt = Date.now();
    await db.snapshots.put({
      id: snapshotId(businessId, opts.kind),
      businessId,
      kind: opts.kind,
      payload: data,
      capturedAt,
    });
    return { data, source: "server", capturedAt };
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const cached = await db.snapshots.get(snapshotId(businessId, opts.kind));
    if (!cached) throw e;
    return { data: cached.payload as T, source: "cache", capturedAt: cached.capturedAt };
  }
}

export function isDashboardSnapshot(data: unknown): data is DashboardSnapshot {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const row = data as Record<string, unknown>;
  return (
    typeof row.greeting === "string" &&
    typeof row.dateLabel === "string" &&
    typeof row.todaySalesTotal === "number" &&
    typeof row.todaySalesCount === "number" &&
    typeof row.debtTotal === "number" &&
    typeof row.debtorCount === "number" &&
    Array.isArray(row.debtors) &&
    typeof row.productCount === "number" &&
    typeof row.lowStockCount === "number" &&
    Array.isArray(row.lowStock) &&
    Array.isArray(row.activity) &&
    (row.cajaState === "none" || row.cajaState === "open" || row.cajaState === "closed") &&
    typeof row.emptyDb === "boolean" &&
    Array.isArray(row.actions)
  );
}

export function isRemoteStats(data: unknown): data is RemoteStats {
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  return (
    typeof row.ventas === "number" &&
    typeof row.period === "string" &&
    typeof row.emptyPeriod === "boolean" &&
    Array.isArray(row) === false
  );
}

/**
 * Dashboard with an honest offline fallback. Server snapshot is complete
 * (local Dexie only holds offline-created rows, so a local recompute
 * would silently undercount); offline serves the last snapshot labeled
 * with its capture time. Never a fake zero.
 */
export async function loadDashboardWithOfflineFallback(): Promise<
  SnapshotResult<DashboardSnapshot>
> {
  let result: { snapshot: DashboardSnapshot; complete: boolean; networkFailure: boolean };
  try {
    result = await loadDashboardResult();
  } catch (e: unknown) {
    // Core queries have no fallback: a transport failure serves the
    // previous snapshot, anything else propagates.
    if (!(e instanceof NetworkError)) throw e;
    return loadCachedSnapshot<DashboardSnapshot>(DASHBOARD_SNAPSHOT_KIND);
  }
  const { snapshot, complete, networkFailure } = result;
  if (!complete) {
    // A partial snapshot must never replace a complete one. Transport
    // causes fall back to the previous snapshot; real server errors
    // propagate so the UI shows an error instead of stale data as fresh.
    if (networkFailure) return loadCachedSnapshot<DashboardSnapshot>(DASHBOARD_SNAPSHOT_KIND);
    throw new Error("Respuesta incompleta del servidor.");
  }
  return saveSnapshot(DASHBOARD_SNAPSHOT_KIND, snapshot);
}

async function loadCachedSnapshot<T>(kind: string): Promise<SnapshotResult<T>> {
  const businessId = requireBusinessId();
  const cached = await getLocalDb().snapshots.get(snapshotId(businessId, kind));
  if (!cached) throw new NetworkError("Sin conexión.");
  return { data: cached.payload as T, source: "cache", capturedAt: cached.capturedAt };
}

async function saveSnapshot<T>(kind: string, data: T): Promise<SnapshotResult<T>> {
  const businessId = requireBusinessId();
  const capturedAt = Date.now();
  await getLocalDb().snapshots.put({
    id: snapshotId(businessId, kind),
    businessId,
    kind,
    payload: data,
    capturedAt,
  });
  return { data, source: "server", capturedAt };
}

export function loadStatsWithOfflineFallback(
  period: "hoy" | "semana" | "mes",
): Promise<SnapshotResult<RemoteStats>> {
  return loadWithSnapshot({
    kind: statsSnapshotKind(period),
    fetch: () => getPwaApi().stats.get(period),
    validate: isRemoteStats,
  });
}

export async function clearSnapshots(businessId: string): Promise<void> {
  await getLocalDb().snapshots.where("businessId").equals(businessId).delete();
}
