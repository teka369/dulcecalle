/**
 * Data-backend selection.
 *
 * M3: the PWA business UI talks HTTP (UUID). Dexie repositories remain
 * for domain tests and are not wired to pages/stores.
 *
 * Production: Render Nest (`PRODUCTION_API_ORIGIN`). Override with
 * NEXT_PUBLIC_API_URL. Dev: same-origin `/v1` (Next rewrites to Nest).
 */

export type DataBackend = "dexie" | "http";

/** Public Nest host on Render. Not a secret. */
export const PRODUCTION_API_ORIGIN = "https://dulcecalle-teka369.onrender.com";

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
  if (pwaStorage() === "http") {
    if (process.env.NODE_ENV === "production") {
      return `${PRODUCTION_API_ORIGIN}/v1`;
    }
    return "/v1";
  }
  return undefined;
}
