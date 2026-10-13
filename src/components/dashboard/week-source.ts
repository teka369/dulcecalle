import { getLocalDb } from "@/data/local/db";
import { getPwaApi } from "@/data/pwa/api";
import { buildWeekSeries, weekStartKey, type WeekDay } from "@/domain/dashboard/week";

/**
 * Read-only 7-day ventas series from the M6 local store (`dulcecalle-local`),
 * scoped to the active business like offline-history. Returns null unless
 * this business's sales history was prepared on this device within 24h
 * (90-day window ≥ 7 days) — otherwise past days could read as 0 and the chart would lie.
 * No writes, no network, no schema change.
 */
/** History older than this is treated as unreliable for the 7-day chart. */
export const WEEK_HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Chart gating only (does not change offline-history.historyReady): the
 * business's `history:sales` marker must exist and have been written within
 * the last 24h, otherwise recent days may be missing.
 */
export async function weekHistoryFresh(businessId: string, now: number): Promise<boolean> {
  const row = await getLocalDb().cacheMeta.get(`${businessId}::history:sales`);
  if (!row || row.businessId !== businessId) return false;
  const age = now - row.cachedAt;
  return age >= 0 && age <= WEEK_HISTORY_MAX_AGE_MS;
}

export async function loadWeekSeries(
  now: number,
  todayTotal: number,
): Promise<WeekDay[] | null> {
  const businessId = getPwaApi().session.businessId;
  if (!businessId) return null;
  if (!(await weekHistoryFresh(businessId, now))) return null;
  const from = weekStartKey(now);
  const sales = await getLocalDb()
    .sales.where("businessId")
    .equals(businessId)
    .filter((s) => s.occurredOn >= from)
    .toArray();
  return buildWeekSeries(sales, businessId, now, todayTotal);
}
