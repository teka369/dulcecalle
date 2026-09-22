import { NetworkError } from "../errors";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import type { RemoteStats } from "../http/mappers";
import { getPwaApi } from "./api";
import { loadHttpDashboard } from "./dashboard";
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

function isDashboardSnapshot(data: unknown): data is DashboardSnapshot {
  const row = data as Record<string, unknown> | null;
  return !!row && typeof row === "object";
}

function isRemoteStats(data: unknown): data is RemoteStats {
  const row = data as Record<string, unknown> | null;
  return (
    !!row &&
    typeof row === "object" &&
    typeof row.ventas === "number" &&
    typeof row.period === "string"
  );
}

/**
 * Dashboard with an honest offline fallback. Server snapshot is complete
 * (local Dexie only holds offline-created rows, so a local recompute
 * would silently undercount); offline serves the last snapshot labeled
 * with its capture time. Never a fake zero.
 */
export function loadDashboardWithOfflineFallback(): Promise<SnapshotResult<DashboardSnapshot>> {
  return loadWithSnapshot({
    kind: DASHBOARD_SNAPSHOT_KIND,
    fetch: () => loadHttpDashboard(),
    validate: isDashboardSnapshot,
  });
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
