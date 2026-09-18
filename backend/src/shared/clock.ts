/** Commercial day in the business timezone. Never SQL CURRENT_DATE. */

export function occurredOnKey(
  timeZone: string,
  at: Date = new Date(),
): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(at);
}

/** Prisma DATE column: midnight UTC of the YYYY-MM-DD calendar day. */
export function occurredOnDate(
  timeZone: string,
  at: Date = new Date(),
): Date {
  const key = occurredOnKey(timeZone, at);
  return new Date(`${key}T00:00:00.000Z`);
}

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const DEFAULT_TZ = "America/Bogota";
