import { expect, test } from "@playwright/test";
import { installFakeApi, readiness } from "./fixtures";

/**
 * B1 + B5 end to end on a prepared device:
 * - open caja offline, then sync twice (first response lost) -> exactly 1 session on the server;
 * - offline aporte is counted in the on-screen "Efectivo esperado" while still pending.
 */
test("B1/B5: open caja offline + offline aporte -> esperado includes pending move; sync twice = 1 server session", async ({ context, page: prepPage }) => {
  const fake = await installFakeApi(context);

  // Prepared device (SW in control, PREP ready) with no caja open today.
  await prepPage.goto("/");
  await prepPage.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await prepPage.reload();
  await expect.poll(() => prepPage.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => readiness(prepPage), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  // Same as the cold-load spec: the offline part runs in a fresh page (no stray prep-page navigations).
  await prepPage.close();

  // Offline: open caja with base 10.000.
  fake.offline = true;
  await context.setOffline(true);
  const page = await context.newPage();
  await page.goto("/mas/caja");
  await expect(page.getByRole("heading", { level: 1, name: "Caja" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(/Con cuánto abres/).fill("10000");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  const esperado = page.getByText("Efectivo esperado").first();
  await expect(esperado).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("main")).toContainText(/10\.000/);

  // Offline aporte (Efectivo 4.700) while the open is still pending.
  await page.getByRole("link", { name: "Aporte" }).click();
  await expect(page.getByRole("heading", { name: "Aporte de capital" })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel("Monto").fill("4700");
  await page.getByRole("button", { name: "Confirmar aporte" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/mas/caja");
  await expect(page.locator("main")).toContainText(/14\.700/, { timeout: 15_000 });
  expect(fake.cash.posts, "nothing reaches the server while offline").toEqual([]);

  // Back online: first sync's open response is lost after the server applied it, then sync again.
  fake.cash.dropNextOpenResponse = true;
  fake.offline = false;
  await context.setOffline(false);
  await expect.poll(() => fake.cash.posts.filter((x) => x.path === "/cash/sessions").length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  // Second sync: the user retries the failed "Apertura de caja" from the sync center (same intent).
  await page.getByRole("button", { name: /^Datos y sincronización/ }).first().click();
  await page.getByRole("button", { name: /Apertura de caja/ }).first().click();
  await page.getByRole("button", { name: "Reintentar" }).first().click();
  await expect
    .poll(() => fake.cash.posts.filter((x) => x.path === "/cash/aportes").length, { timeout: 60_000, intervals: [1000] })
    .toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(1500);

  const opens = fake.cash.posts.filter((x) => x.path === "/cash/sessions");
  expect(opens.length, "open was retried after the lost response").toBeGreaterThanOrEqual(2);
  expect(new Set(opens.map((x) => x.key)).size, "same Idempotency-Key on every open attempt").toBe(1);
  expect(fake.cash.sessions.size, "exactly one caja session on the server").toBe(1);
  expect(fake.cash.moves.size, "exactly one aporte on the server").toBe(1);
  console.log(`opens=${opens.length} key=${opens[0].key} sessions=${fake.cash.sessions.size} moves=${fake.cash.moves.size}`);

  // Server state now drives the screen: still 14.700.
  await page.reload();
  await expect(page.locator("main")).toContainText(/14\.700/, { timeout: 15_000 });
});
