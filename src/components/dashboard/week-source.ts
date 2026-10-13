import { getLocalDb } from "@/data/local/db";
import { getPwaApi } from "@/data/pwa/api";
import { historyReady } from "@/data/pwa/offline-history";
import { buildWeekSeries, weekStartKey, type WeekDay } from "@/domain/dashboard/week";

/**
 * Read-only 7-day ventas series from the M6 local store (`dulcecalle-local`),
 * scoped to the active business like offline-history. Returns null unless
 * this business's sales history was prepared on this device (90-day window
 * ≥ 7 days) — otherwise past days could read as 0 and the chart would lie.
 * No writes, no network, no schema change.
 */
export async function loadWeekSeries(
  now: number,
  todayTotal: number,
): Promise<WeekDay[] | null> {
  const businessId = getPwaApi().session.businessId;
  if (!businessId) return null;
  if (!(await historyReady(businessId, "history:sales"))) return null;
  const from = weekStartKey(now);
  const sales = await getLocalDb()
    .sales.where("businessId")
    .equals(businessId)
    .filter((s) => s.occurredOn >= from)
    .toArray();
  return buildWeekSeries(sales, businessId, now, todayTotal);
}
