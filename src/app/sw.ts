import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NavigationRoute, NetworkOnly, Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Cache Storage = app shell only.
 * Business data (Dexie / IndexedDB) and future /api traffic must never be cached here.
 */
const runtimeCaching = [
  {
    matcher: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
      sameOrigin && url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

/**
 * Offline document navigation: the app shell ("/") is precached, but
 * per-route documents are server-rendered on demand. When a business route
 * cannot load offline, redirect to the cached shell so the app boots with
 * local readers + Sync UI instead of dying. "/" itself and "/offline" are
 * excluded: "/" falls through to the /offline fallback, avoiding loops.
 */
serwist.registerRoute(
  new NavigationRoute(
    async ({ request, event }) => {
      try {
        const preload = await (
          event as unknown as {
            preloadResponse?: Promise<Response | undefined>;
          }
        ).preloadResponse;
        if (preload) return preload;
        return await fetch(request);
      } catch (error) {
        const { pathname } = new URL(request.url);
        if (pathname === "/" || pathname === "/offline") throw error;
        return Response.redirect("/", 302);
      }
    },
    {
      denylist: [/^\/api\//, /^\/_next\//, /^\/offline$/, /^\/sw\.js$/],
    },
  ),
);

serwist.addEventListeners();
