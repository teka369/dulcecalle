import { expect, test, type Page } from "@playwright/test";
import { installFakeApi, readiness, C0, type Fake } from "./fixtures";

/**
 * reloadOnOnline is off (no automatic page reload when the connection comes
 * back). An open screen must still pick up the server's new data after the
 * reconnect sync, on its own: no reload, no navigation.
 */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

async function prepared(page: Page, fake: Fake) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  void fake;
}

/** Marks this document; a reload or document navigation would drop it. */
async function markDocument(page: Page) {
  await page.evaluate(() => ((window as unknown as { __noReload?: number }).__noReload = 1));
}
async function expectSameDocument(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: number }).__noReload), "no page reload").toBe(1);
}

async function goOfflineThenBack(page: Page, fake: Fake, change: () => void) {
  await markDocument(page);
  fake.offline = true;
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  change(); // another device writes while this phone is offline
  fake.offline = false;
  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
}

test("Caja picks up server moves after reconnect, without reload", async ({ context, page }) => {
  test.setTimeout(300_000);
  const fake = await installFakeApi(context);
  await prepared(page, fake);
  await page.goto("/mas/caja");
  await page.getByLabel(/Con cuánto abres/).fill("9000");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  await expect(page.locator("main")).toContainText(/9\.000/, { timeout: 15_000 });
  await goOfflineThenBack(page, fake, () => {
    fake.cash.moves.set("other-device", { id: crypto.randomUUID(), amount: 5000, direction: "in", method: "Efectivo", kind: "aporte", refType: null, refId: null, occurredOn: today, createdAt: new Date().toISOString() });
  });
  await expect(page.locator("main")).toContainText(/14\.000/, { timeout: 20_000 });
  await expectSameDocument(page);
});

test("Inicio picks up new sales totals after reconnect, without reload", async ({ context, page }) => {
  test.setTimeout(300_000);
  const fake = await installFakeApi(context);
  await prepared(page, fake);
  await page.goto("/");
  await expect(page.locator("body")).toContainText(/3\.000/, { timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText(/8\.000/);
  await goOfflineThenBack(page, fake, () => {
    // Inicio's "Hoy" total is computed from today's /sales list.
    fake.server.extraSales.push({
      id: "00000000-0000-4000-8000-000000000598", customerId: C0, paymentKind: "paid", method: "Efectivo", saleTotal: 5000, amountReceived: 5000, credit: 0, note: null,
      occurredOn: today, createdAt: new Date().toISOString(), lines: [],
    });
  });
  await expect(page.locator("body")).toContainText(/8\.000/, { timeout: 20_000 });
  await expectSameDocument(page);
});

test("Ventas picks up a new server sale after reconnect, without reload", async ({ context, page }) => {
  test.setTimeout(300_000);
  const fake = await installFakeApi(context);
  await prepared(page, fake);
  await page.goto("/ventas");
  await expect(page.locator("main")).toContainText(/3\.000/, { timeout: 15_000 });
  await expect(page.locator("main")).not.toContainText(/7\.777/);
  await goOfflineThenBack(page, fake, () => {
    fake.server.extraSales.push({
      id: "00000000-0000-4000-8000-000000000599", customerId: C0, paymentKind: "paid", method: "Efectivo", saleTotal: 7777, amountReceived: 7777, credit: 0, note: null,
      occurredOn: today, createdAt: new Date().toISOString(), lines: [],
    });
  });
  await expect(page.locator("main")).toContainText(/7\.777/, { timeout: 20_000 });
  await expectSameDocument(page);
});
