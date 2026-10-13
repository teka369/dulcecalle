import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
} from "serwist";
import { DOCUMENTS_MAX_ENTRIES, swNavigationRoute } from "@/data/pwa/sw-routing";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Cache Storage = app shell only.
 * Business data (Dexie / IndexedDB) and future /api traffic must never be cached here.
 *
 * Order matters: Serwist registers runtimeCaching during construction (first
 * match wins). Navigate/documents MUST come before ...defaultCache so the
 * production catch-all "others" does not steal document navigations and
 * fall through to the /offline PrecacheFallbackPlugin.
 */
const runtimeCaching = [
  {
    matcher: ({ sameOrigin, url }: { sameOrigin: boolean; url: URL }) =>
      sameOrigin && url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
  {
    // Product photos live on Cloudinary (never business data in the
    // PWA cache, only bytes). Cache-first with tight bounds so catalogs
    // and the customer portal render offline after first view.
    matcher: ({ url }: { sameOrigin: boolean; url: URL }) =>
      url.hostname === "res.cloudinary.com",
    handler: new CacheFirst({
      cacheName: "cloudinary-images",
      plugins: [
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        // ~100 photos, 30 days max. Eviction is LRU by last use.
        new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
      ],
    }),
  },
  {
    // Entity URLs (fichas, actions, /mas/caja/gestionar/[id]): network only,
    // never cached, so visiting fichas cannot evict PREP's static docs.
    // Offline + miss: serve the parent list document PREP stored (the URL
    // stays; the shell reopens the ficha from IndexedDB). Otherwise /offline.
    matcher: ({ request, url }: { request: Request; url: URL }) =>
      request.mode === "navigate" && swNavigationRoute(url.pathname).kind === "entity",
    handler: async ({ request, url }: { request: Request; url: URL }): Promise<Response> => {
      try {
        return await fetch(request);
      } catch {
        const route = swNavigationRoute(url.pathname);
        if (route.kind === "entity" && route.fallback) {
          const doc = await (await caches.open("documents")).match(route.fallback);
          if (doc) return doc;
        }
        return (await serwist.matchPrecache("/offline")) ?? Response.error();
      }
    },
  },
  {
    // Offline document navigation: NetworkFirst into "documents" so an
    // offline reload boots a prepared static screen. Must register before
    // ...defaultCache.
    matcher: ({ request, url }: { request: Request; url: URL }) =>
      request.mode === "navigate" && swNavigationRoute(url.pathname).kind === "document",
    handler: new NetworkFirst({
      cacheName: "documents",
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        // Static screens only (entities never land here); bound above the
        // number of static pages so PREP's documents are not evicted.
        new ExpirationPlugin({ maxEntries: DOCUMENTS_MAX_ENTRIES, maxAgeSeconds: 7 * 24 * 60 * 60 }),
      ],
    }),
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

serwist.addEventListeners();
