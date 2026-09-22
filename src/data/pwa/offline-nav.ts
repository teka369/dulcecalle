/**
 * Offline-aware navigation primitives.
 *
 * Online: normal SPA navigation (router.push/replace, Link prefetch).
 * Offline: a client (RSC) navigation cannot succeed, so links become full
 * document navigations. The Service Worker then serves the prepared
 * document for that URL, or /offline when it was never cached.
 */

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
    window.location.assign(href);
    return;
  }
  if (opts?.replace && router.replace) router.replace(href);
  else router.push(href);
}
