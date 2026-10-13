import { addCop } from "@/domain/money";

/** Minimal read-only shape needed from locally stored sales. */
export type WeekSaleLike = { createdAt: number; saleTotal: number };

export type WeekDay = {
  /** YYYY-MM-DD in America/Bogota. */
  key: string;
  /** Short Spanish weekday (Lun…Dom). */
  label: string;
  total: number;
  isToday: boolean;
};

const DAY_MS = 86_400_000;
const LABELS: Record<string, string> = {
  Mon: "Lun",
  Tue: "Mar",
  Wed: "Mié",
  Thu: "Jue",
  Fri: "Vie",
  Sat: "Sáb",
  Sun: "Dom",
};

const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" });
const wdFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Bogota",
  weekday: "short",
});

export function bogotaDayKey(ms: number): string {
  return keyFmt.format(new Date(ms));
}

/** Earliest instant worth querying for the 7-day window (generous; filtered by key). */
export function weekWindowStart(now: number): number {
  return now - 7 * DAY_MS;
}

/**
 * Ventas (saleTotal) per Bogota day for the last 7 days, oldest first,
 * today last. Sales only — never mixes recibido, fiado or caja.
 * `todayTotal` (from the dashboard snapshot) overrides today's bucket so
 * the chart matches the hero amount exactly.
 */
export function buildWeekSeries(
  sales: readonly WeekSaleLike[],
  now: number,
  todayTotal?: number,
): WeekDay[] {
  const days: WeekDay[] = [];
  for (let i = 6; i >= 0; i--) {
    // Bogota has no DST, so 24h steps land on distinct calendar days.
    const ms = now - i * DAY_MS;
    days.push({
      key: bogotaDayKey(ms),
      label: LABELS[wdFmt.format(new Date(ms))] ?? "",
      total: 0,
      isToday: i === 0,
    });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const s of sales) {
    const day = byKey.get(bogotaDayKey(s.createdAt));
    if (day) day.total = addCop(day.total, s.saleTotal);
  }
  if (todayTotal != null) days[6].total = todayTotal;
  return days;
}

export function weekTotal(days: readonly WeekDay[]): number {
  return days.reduce((s, d) => addCop(s, d.total), 0);
}
