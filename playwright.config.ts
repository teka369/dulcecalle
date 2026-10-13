import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4317);

/** Runs against a production build: `npm run build` first. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  timeout: 240_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, serviceWorkers: "allow", viewport: { width: 390, height: 780 } },
  webServer: {
    command: `npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/offline`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
