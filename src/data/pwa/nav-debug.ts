/**
 * DEV-ONLY navigation diagnostics for the offline Caja tile bounce.
 *
 * Off in production unless explicitly enabled on the device with
 * localStorage["dc:navdebug"] = "1". Only console.info; never changes
 * behaviour (no preventDefault, no navigation, no state writes).
 */
export const NAV_DEBUG_KEY = "dc:navdebug";
export const NAV_DEBUG_CHANNEL = "dc-navdebug";

export function navDebugOn(): boolean {
  if (process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") return true;
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(NAV_DEBUG_KEY) === "1";
  } catch {
    return false;
  }
}

export function navDebug(event: string, data: Record<string, unknown> = {}): void {
  if (!navDebugOn()) return;
  try {
    const path = typeof location !== "undefined" ? location.pathname : "?";
    console.info(`[dc-nav] t=${Math.round(performance.now())} at=${path} ${event} ${JSON.stringify(data)}`);
  } catch {
    /* diagnostics never throw */
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url, location.href);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

let installed = false;

/** Page-level listeners: every navigate event, pagehide/pageshow (bfcache), SW route reports. */
export function installNavDebug(): void {
  if (installed || typeof window === "undefined" || !navDebugOn()) return;
  installed = true;
  navDebug("boot", { nav: (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type });
  const nav = (window as unknown as {
    navigation?: { addEventListener: (t: string, f: (e: { destination: { url: string }; navigationType: string; cancelable: boolean; userInitiated?: boolean; defaultPrevented: boolean }) => void) => void };
  }).navigation;
  nav?.addEventListener("navigate", (e) => {
    // queueMicrotask: read defaultPrevented after the guard listener ran.
    queueMicrotask(() =>
      navDebug("navigate-event", {
        to: pathOf(e.destination.url),
        type: e.navigationType,
        cancelable: e.cancelable,
        user: e.userInitiated ?? null,
        prevented: e.defaultPrevented,
      }),
    );
  });
  // capture: runs before @serwist/next's reloadOnOnline listener.
  window.addEventListener("online", () => navDebug("window-online", { onLine: navigator.onLine, hidden: document.visibilityState }), { capture: true });
  window.addEventListener("offline", () => navDebug("window-offline", { onLine: navigator.onLine }), { capture: true });
  window.addEventListener("pagehide", (e) => navDebug("pagehide", { persisted: e.persisted }));
  window.addEventListener("pageshow", (e) => navDebug("pageshow", { persisted: e.persisted }));
  try {
    new BroadcastChannel(NAV_DEBUG_CHANNEL).onmessage = (m) => navDebug("sw", m.data as Record<string, unknown>);
  } catch {
    /* no BroadcastChannel */
  }
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: NAV_DEBUG_KEY, on: true });
    navigator.serviceWorker?.addEventListener("controllerchange", () => {
      navDebug("sw-controllerchange");
      navigator.serviceWorker.controller?.postMessage({ type: NAV_DEBUG_KEY, on: true });
    });
  } catch {
    /* no SW */
  }
}
