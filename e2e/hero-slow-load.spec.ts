import { expect, test, type Page } from "@playwright/test";
import { CUS, installFakeApi, readiness } from "./fixtures";

const SLOW = /^\/(customers|products|suppliers|sales)$/;

/** Sample the hero repeatedly during the slow window; it must never show a fake 0. */
async function sampleHero(page: Page, ms: number): Promise<string[]> {
  const seen: string[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    seen.push((await page.locator("main").first().innerText().catch(() => "")) ?? "");
    await page.waitForTimeout(150);
  }
  return seen;
}

const FAKE_ZERO = /\$\s?0(?![\d.,])|\b0 clientes deben\b/;

test("slow API with local data: Clientes/Inventario hero show Dexie figures, never $0 / 0", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");

  fake.slow = SLOW;
  fake.slowMs = 8_000;

  const c = await context.newPage();
  await c.goto("/clientes");
  await expect(c.getByText("1 cliente debe")).toBeVisible({ timeout: 4_000 });
  await expect(c.getByText(CUS.name).first()).toBeVisible();
  for (const t of await sampleHero(c, 2_500)) expect(t).not.toMatch(FAKE_ZERO);
  await c.close();

  const inv = await context.newPage();
  await inv.goto("/inventario");
  const metrics = inv.getByLabel("Resumen de inventario");
  await expect(metrics).toContainText("2", { timeout: 4_000 });
  for (let i = 0; i < 15; i++) {
    await expect(metrics.getByTestId("metric-loading")).toHaveCount(0);
    // Local Dexie figure (2 products), never "0 productos".
    expect(await metrics.innerText()).toMatch(/^\s*2\s*\n\s*productos/m);
    await inv.waitForTimeout(150);
  }
  await inv.close();
});

test("slow API without local data: hero figures are a skeleton, not $0", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  fake.slow = SLOW;
  fake.slowMs = 6_000;
  await page.goto("/clientes");
  await expect(page.getByTestId("hero-amount-loading")).toBeVisible({ timeout: 4_000 });
  for (const t of await sampleHero(page, 2_000)) expect(t).not.toMatch(FAKE_ZERO);
  await page.goto("/inventario");
  await expect(page.getByLabel("Resumen de inventario").getByTestId("metric-loading").first()).toBeVisible({ timeout: 4_000 });
  await page.goto("/ventas");
  await expect(page.getByTestId("hero-amount-loading")).toBeVisible({ timeout: 4_000 });
  for (const t of await sampleHero(page, 1_500)) expect(t).not.toMatch(FAKE_ZERO);
});
