import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  CacheableResponsePlugin,
  ExpirationPlugin,
  NavigationRoute,
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
 * Offline document navigation: each business route is cached under its own
 * URL the first time it loads online (NetworkFirst). Offline reloads serve
 * that same document, so the URL, flight data and router state stay
 * consistent and the app boots where the user was, with local readers +
 * Sync UI. Routes never visited have no cached document and fall through
 * to the /offline fallback (last resort). No redirects: a 302 to "/" would
 * destroy the original route and trap back-button navigation.
 */
serwist.registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "documents",
      plugins: [
        new CacheableResponsePlugin({ statuses: [200] }),
        // Small PWA: a couple of dozen documents, one week max.
        new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 7 * 24 * 60 * 60 }),
      ],
    }),
    {
      denylist: [/^\/api\//, /^\/_next\//, /^\/offline$/, /^\/sw\.js$/],
    },
  ),
);

serwist.addEventListeners();
