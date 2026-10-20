/**
 * Offline-aware navigation primitives.
 *
 * Online: normal SPA navigation (router.push/replace, Link prefetch).
 * Offline static routes: a full document navigation so the service worker
 * can serve the prepared document (or /offline).
 * Offline entity fichas: stay inside the already-loaded shell and read
 * IndexedDB. Do not router.push — that asks Next for an RSC payload.
 * A cold offline load of an entity URL is restored by EntityViewHost (boot-restore.ts).
 */
import { parseEntityHref } from "./entity-href";
import { entityViewStore } from "@/store/entityViewStore";
import { navDebug } from "./nav-debug";

export function isOffline(): boolean {
  try {
    return typeof navigator !== "undefined" && !navigator.onLine;
  } catch {
    return false;
  }
}

type NavigateEventLike = {
  destination: { url: string };
  cancelable: boolean;
  preventDefault: () => void;
};

let leavingTo: string | null = null;
let guardInstalled = false;

/**
 * Offline tile bounce (QA followups-14f36c0): an offline document navigation
 * is renderer-initiated, so any later navigation of this page (Next's
 * hard-navigation fallback to the current URL after a failed RSC fetch,
 * Serwist's reload, a second tap) cancels it and the user "bounces" back to
 * the page they left. While a document navigation we started is in flight,
 * cancel competing navigations to any other URL (Navigation API).
 */
function guardOfflineDocumentNav(target: string): void {
  leavingTo = target;
  setTimeout(() => {
    if (leavingTo === target) leavingTo = null;
  }, 10_000);
  const nav = (window as unknown as { navigation?: { addEventListener: (t: string, f: (e: NavigateEventLike) => void) => void } }).navigation;
  if (!nav || guardInstalled) return;
  guardInstalled = true;
  nav.addEventListener("navigate", (e) => {
    if (leavingTo == null || !e.cancelable) return;
    if (e.destination.url !== leavingTo) {
      navDebug("guard-blocked", { to: e.destination.url, leavingTo });
      e.preventDefault();
    }
  });
  window.addEventListener?.("pageshow", () => {
    leavingTo = null;
  });
}

/** Offline static route: a full document navigation the SW serves from the prepared cache. */
export function offlineDocumentNavigate(href: string): void {
  try {
    guardOfflineDocumentNav(new URL(href, window.location.href).href);
  } catch {
    /* no guard without a resolvable URL; the navigation itself still happens */
  }
  navDebug("offline-assign", { from: window.location.pathname, to: href });
  window.location.assign(href);
}

/** Test seam. */
export function __offlineNavTarget(): string | null {
  return leavingTo;
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
    offlineDocumentNavigate(href);
    return;
  }
  if (opts?.replace && router.replace) router.replace(href);
  else router.push(href);
}

