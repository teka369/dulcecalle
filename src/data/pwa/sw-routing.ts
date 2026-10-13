/**
 * Pure navigation routing for the service worker (src/app/sw.ts). Kept
 * outside sw.ts so it can be unit tested.
 *
 * - passthrough: /api, /_next, /offline, /sw.js — never handled here.
 * - entity: per-entity documents are NOT cached (they would evict PREP's
 *   static docs). Network first; offline + miss serves `fallback` (the
 *   parent list document PREP stores) and the shell restores the URL.
 *   `fallback: null` means /offline.
 * - document: static screens, NetworkFirst into the "documents" cache.
 */
import { coldLoadParentPath, entityParentPath, isGestionarCajaDetail } from "./entity-href";

export type SwNavigationRoute =
  | { kind: "passthrough" }
  | { kind: "entity"; fallback: string | null }
  | { kind: "document" };

export function swNavigationRoute(pathname: string): SwNavigationRoute {
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/offline" ||
    pathname === "/sw.js"
  ) {
    return { kind: "passthrough" };
  }
  if (entityParentPath(pathname) || isGestionarCajaDetail(pathname)) {
    return { kind: "entity", fallback: coldLoadParentPath(pathname) };
  }
  return { kind: "document" };
}

/** Bound for the "documents" cache: above the number of static screens so PREP docs are never evicted. */
export const DOCUMENTS_MAX_ENTRIES = 80;
