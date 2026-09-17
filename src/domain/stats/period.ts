import { endOfLocalDay, localDateKey, startOfLocalDay } from "@/domain/cash/day";
import type { StatsPeriod } from "./copy";

export type PeriodRange = {
  period: StatsPeriod;
  /** Inclusive start ms (local). */
  startMs: number;
  /** Inclusive end ms (local). */
  endMs: number;
  label: string;
};

/** Hoy = local calendar day. */
export function rangeHoy(nowMs: number = Date.now()): PeriodRange {
  return {
    period: "hoy",
    startMs: startOfLocalDay(nowMs),
    endMs: endOfLocalDay(nowMs),
    label: "Hoy",
  };
}

/** Semana = últimos 7 días locales inclusive (hoy − 6 … hoy). */
export function rangeSemana(nowMs: number = Date.now()): PeriodRange {
  const end = endOfLocalDay(nowMs);
  const startDay = new Date(startOfLocalDay(nowMs));
  startDay.setDate(startDay.getDate() - 6);
  return {
    period: "semana",
    startMs: startDay.getTime(),
    endMs: end,
    label: "Semana",
  };
}

/** Mes = mes calendario local en curso. */
export function rangeMes(nowMs: number = Date.now()): PeriodRange {
  const d = new Date(nowMs);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end = endOfLocalDay(nowMs);
  return {
    period: "mes",
    startMs: start.getTime(),
    endMs: end,
    label: "Mes",
  };
}

export function rangeForPeriod(
  period: StatsPeriod,
  nowMs: number = Date.now(),
): PeriodRange {
  if (period === "hoy") return rangeHoy(nowMs);
  if (period === "semana") return rangeSemana(nowMs);
  return rangeMes(nowMs);
}

export function inRange(ms: number, range: PeriodRange): boolean {
  return ms >= range.startMs && ms <= range.endMs;
}

/** Local YYYY-MM-DD keys covered by the range (for session lookup). */
export function localDatesInRange(range: PeriodRange): string[] {
  const keys: string[] = [];
  const cursor = new Date(range.startMs);
  cursor.setHours(0, 0, 0, 0);
  const endKey = localDateKey(range.endMs);
  for (let i = 0; i < 62; i++) {
    const key = localDateKey(cursor.getTime());
    keys.push(key);
    if (key === endKey) break;
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}
