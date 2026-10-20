import { expect, type Page } from "@playwright/test";
import { readiness } from "./fixtures";

/** loop/v1 shared helpers for detail-page error specs. */
export function trackRejections(page: Page): string[] {
  const out: string[] = [];
  page.on("pageerror", (e) => out.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /unhandled|uncaught/i.test(m.text())) out.push(m.text());
  });
  return out;
}

/** Finish offline prep first so the prep modal (which has its own Reintentar) is not on screen. */
export async function warmUp(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
}

