/**
 * Data-backend selection (Fase 6.6).
 *
 * Production PWA is ALWAYS Dexie. HTTP is an explicit, tested adapter
 * for a later phase — never auto-selected because an API is reachable.
 *
 * NEXT_PUBLIC_DATA_BACKEND=http does **not** switch the UI. That would
 * mix Dexie numeric ids with server UUIDs and could upload live books.
 * Callers that want HTTP construct `HttpRepository` themselves (tests).
 */

export type DataBackend = "dexie" | "http";

export function getDataBackend(): DataBackend {
  return process.env.NEXT_PUBLIC_DATA_BACKEND === "http" ? "http" : "dexie";
}

/** Storage the PWA UI / store / pages actually use. Locked to Dexie. */
export function pwaStorage(): "dexie" {
  return "dexie";
}

export function apiBaseUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : undefined;
}
