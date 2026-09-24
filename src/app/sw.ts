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
    // Offline document navigation: NetworkFirst into "documents" so an
    // offline reload boots where the user was. Denylist matches the old
    // NavigationRoute. Must register before ...defaultCache ("others").
    matcher: ({ request, url }: { request: Request; url: URL }) => {
      if (request.mode !== "navigate") return false;
      const p = url.pathname;
      return !(
        p.startsWith("/api/") ||
        p.startsWith("/_next/") ||
        p === "/offline" ||
        p === "/sw.js"
      );
    },
    handler: new NetworkFirst({
      cacheName: "documents",
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        // Small PWA: a couple of dozen documents, one week max.
        new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 }),
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
