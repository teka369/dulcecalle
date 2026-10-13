/** Presentation helpers for /ventas (grouping by business day, Bogotá). */

export type DayGroupable = { occurredOn?: string | null; createdAt?: number | null };

const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" });
const timeFmt = new Intl.DateTimeFormat("es-CO", {
  timeZone: "America/Bogota",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayFmt = new Intl.DateTimeFormat("es-CO", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
});

export function bogotaKey(ms: number): string {
  return keyFmt.format(new Date(ms));
}

export function saleDayKey(s: DayGroupable): string {
  if (s.occurredOn) return s.occurredOn;
  if (s.createdAt) return bogotaKey(s.createdAt);
  return "";
}

export function saleTime(createdAt: number | null | undefined): string | null {
  if (!createdAt) return null;
  return timeFmt.format(new Date(createdAt));
}

/** «HOY · MAR 13 OCT» / «LUN 12 OCT» (SectionHead uppercases). */
export function dayHeading(key: string, todayKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key || "Sin fecha";
  const [y, m, d] = key.split("-").map(Number);
  const parts = dayFmt.formatToParts(new Date(Date.UTC(y, m - 1, d)));
  const pick = (t: Intl.DateTimeFormatPartTypes) =>
    (parts.find((p) => p.type === t)?.value ?? "").replace(/\./g, "");
  const label = `${pick("weekday")} ${pick("day")} ${pick("month")}`;
  return key === todayKey ? `Hoy · ${label}` : label;
}

/** Groups in the given order (list is already newest-first). */
export function groupByDay<T extends DayGroupable>(rows: ReadonlyArray<T>): Array<{ key: string; rows: T[] }> {
  const out: Array<{ key: string; rows: T[] }> = [];
  const idx = new Map<string, number>();
  for (const r of rows) {
    const k = saleDayKey(r);
    let i = idx.get(k);
    if (i == null) {
      i = out.length;
      idx.set(k, i);
      out.push({ key: k, rows: [] });
    }
    out[i].rows.push(r);
  }
  return out;
}
