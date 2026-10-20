import { expect, test } from "@playwright/test";
import { installFakeApi, readiness } from "./fixtures";

const TILES: Array<[string, string, RegExp]> = [
  ["Aporte", "/mas/caja/aporte", /Confirmar aporte/],
  ["Retiro", "/mas/caja/retiro", /Confirmar retiro/],
  ["Gasto", "/mas/gastos/nuevo", /Confirmar gasto/],
];
const ROUNDS = Number(process.env.TILE_ROUNDS ?? 12);

test("offline Caja tiles never bounce back to /mas/caja (30+ taps)", async ({ context, page: prep }) => {
  test.setTimeout(600_000);
  const fake = await installFakeApi(context);
  await prep.goto("/");
  await prep.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await prep.reload();
  await expect.poll(() => prep.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => readiness(prep), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  // Same page that ran PREP (as on a real phone; the Tester's repro).
  const page = prep;
  await page.goto("/mas/caja");
  await page.getByLabel(/Con cuánto abres/).fill("9000");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  await expect(page.getByText("Efectivo esperado").first()).toBeVisible({ timeout: 15_000 });
  fake.offline = true;
  await context.setOffline(true);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Page.enable");
  const navs: string[] = [];
  cdp.on("Page.frameRequestedNavigation", (e: { url: string; reason: string; disposition: string }) =>
    navs.push(`${e.reason} ${new URL(e.url).pathname}`),
  );

  const bounces: string[] = [];
  let taps = 0;
  for (let i = 0; i < ROUNDS; i++) {
    for (const [name, path, ready] of TILES) {
      await page.goto("/mas/caja");
      await expect(page.locator("main").getByRole("link", { name, exact: true })).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(i % 3 === 0 ? 0 : i % 3 === 1 ? 300 : 1200);
      navs.length = 0;
      // Every other tap, force the competing navigation seen in the field
      // (Next's hard-nav fallback / a reload of the current page) right after the tap.
      if (i % 2 === 1) {
        await page.evaluate((k) => {
          document.addEventListener(
            "click",
            () => setTimeout(() => (k % 4 === 1 ? location.reload() : location.assign("/mas/caja")), 0),
            { once: true, capture: true },
          );
        }, i);
      }
      await page.locator("main").getByRole("link", { name, exact: true }).click();
      taps++;
      const ok = await expect
        .poll(async () => new URL(page.url()).pathname === path && ready.test(await page.locator("body").innerText()), { timeout: 10_000 })
        .toBe(true)
        .then(() => true, () => false);
      await page.waitForTimeout(600);
      const final = new URL(page.url()).pathname;
      if (!ok || final !== path) bounces.push(`${i} ${name} -> ${final} [${navs.join(" | ")}]`);
    }
  }
  console.log(`tiles offline: taps=${taps} bounces=${bounces.length}`, bounces);
  expect(taps).toBeGreaterThanOrEqual(30);
  expect(bounces).toEqual([]);
});
