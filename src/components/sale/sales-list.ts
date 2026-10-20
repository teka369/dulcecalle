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

export type VentasSheetState = "loading" | "error" | "empty" | "filter-empty" | "list";

/** Which state the Ventas sheet shows. An error with no data wins over any filter/empty state. */
export function ventasSheetState(input: {
  ready: boolean;
  error: string | null;
  salesCount: number;
  filteredCount: number;
}): VentasSheetState {
  if (!input.ready) return "loading";
  if (input.error && input.salesCount === 0) return "error";
  if (input.salesCount === 0) return "empty";
  if (input.filteredCount === 0) return "filter-empty";
  return "list";
}

export type VentasHero = "skeleton" | "total" | "local" | "none";

/**
 * Ventas hero. Local rows (offline or a failed read) may be incomplete, so
 * they never get a "Total listado" that reads as complete.
 */
export function ventasHero(input: { ready: boolean; fromCache: boolean; salesCount: number; error: string | null }): VentasHero {
  if (!input.ready) return "skeleton";
  if (input.error && input.salesCount === 0) return "none";
  if (input.fromCache) return "local";
  return "total";
}

/** Online (timeout / server down): "No se pudo cargar." — never "Sin conexión" on an online device. */
export function ventasErrorMessage(e: unknown, online: boolean): string {
  if (online || !(e instanceof Error) || !e.message) return "No se pudo cargar.";
  return e.message;
}

/** Customer label for a sale: name, «Sin cliente» when none, «Cliente» when not cached. */
export function saleCustomerLabel(customerId: string | null | undefined, name: string | null | undefined): string {
  if (name) return name;
  return customerId ? "Cliente" : "Sin cliente";
}

/** Method label: paid → method; credit → «Fiado»; partial → «<method> + Fiado». */
export function saleMethodLabel(paymentKind: string, method: string | null | undefined): string {
  if (paymentKind === "credit") return "Fiado";
  if (paymentKind === "partial") return method ? `${method} + Fiado` : "Fiado";
  return method ?? "—";
}

/** «13 oct · 22:58» date label for a sale row/detail. */
export function saleDateLabel(s: DayGroupable): string {
  const key = saleDayKey(s);
  let date = "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [y, m, d] = key.split("-").map(Number);
    const parts = dayFmt.formatToParts(new Date(Date.UTC(y, m - 1, d)));
    const pick = (t: Intl.DateTimeFormatPartTypes) =>
      (parts.find((p) => p.type === t)?.value ?? "").replace(/\./g, "");
    date = `${pick("day")} ${pick("month")}`;
  }
  const time = saleTime(s.createdAt ?? null);
  return [date, time].filter(Boolean).join(" · ") || "Sin fecha";
}
