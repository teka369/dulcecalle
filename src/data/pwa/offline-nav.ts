/**
 * Offline-aware navigation primitives.
 *
 * Online: normal SPA navigation (router.push/replace, Link prefetch).
 * Offline static routes: a full document navigation so the service worker
 * can serve the prepared document (or /offline).
 * Offline entity fichas: stay inside the already-loaded shell and read
 * IndexedDB. Do not router.push — that asks Next for an RSC payload.
 * A cold load of an entity URL never reaches this module.
 */
import { parseEntityHref } from "./entity-href";
import { entityViewStore } from "@/store/entityViewStore";

export function isOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && !navigator.onLine;
  } catch {
    return false;
  }
}

export type OfflineRouter = {
  push: (href: string) => void;
  replace?: (href: string) => void;
};

export function navigateOfflineAware(
  router: OfflineRouter,
  href: string,
  opts?: { replace?: boolean },
): void {
  if (isOffline() && typeof window !== "undefined") {
    if (parseEntityHref(href)) {
      if (opts?.replace) entityViewStore.replace(href);
      else entityViewStore.open(href);
      return;
    }
    window.location.assign(href);
    return;
  }
  if (opts?.replace && router.replace) router.replace(href);
  else router.push(href);
}

