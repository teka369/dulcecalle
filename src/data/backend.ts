/**
 * Data-backend selection.
 *
 * M3: the PWA business UI talks HTTP (UUID). Dexie repositories remain
 * for domain tests and are not wired to pages/stores.
 */

export type DataBackend = "dexie" | "http";

export function getDataBackend(): DataBackend {
  return process.env.NEXT_PUBLIC_DATA_BACKEND === "dexie" ? "dexie" : "http";
}

/** Storage the PWA UI / store / pages actually use. */
export function pwaStorage(): "http" {
  return "http";
}

export function apiBaseUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  if (pwaStorage() === "http") return "/v1";
  return undefined;
}
