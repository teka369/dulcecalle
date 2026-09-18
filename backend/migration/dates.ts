import { DEFAULT_TZ, occurredOnKey } from "../src/shared/clock";

export function epochToUtcDate(ms: number): Date {
  return new Date(ms);
}

export function occurredOnFromEpoch(
  ms: number,
  timeZone: string = DEFAULT_TZ,
): Date {
  const key = occurredOnKey(timeZone, new Date(ms));
  return new Date(`${key}T00:00:00.000Z`);
}

export function localDateToPg(localDate: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    throw new Error(`invalid localDate ${localDate}`);
  }
  return new Date(`${localDate}T00:00:00.000Z`);
}

export function dateKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}
