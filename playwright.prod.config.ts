import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const PORT = Number(process.env.E2E_PORT ?? 4317);

/**
 * Offline cold start + caja offline against the PRODUCTION build: `next build`
 * then `next start` (real Serwist service worker registered and controlling
 * the page; the specs assert navigator.serviceWorker.controller). Never dev.
 */
export default defineConfig({
  ...base,
  testMatch: ["**/offline-cold-load.spec.ts", "**/caja-offline.spec.ts", "**/caja-tiles-offline.spec.ts"],
  webServer: {
    command: `npm run build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/offline`,
    reuseExistingServer: false,
    timeout: 600_000,
  },
});
