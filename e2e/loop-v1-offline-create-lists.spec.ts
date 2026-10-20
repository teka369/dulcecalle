import { expect, test } from "@playwright/test";
import { CUS, installFakeApi, readiness } from "./fixtures";

/**
 * loop/v1 Tester HIGH: a customer created offline vanished from Clientes once
 * online, until its create synced. Online with the sync blocked (POST hangs)
 * it must be listed once and counted; after the sync finishes, still once.
 */
test("offline-created customer: listed once while sync is blocked, once after sync, counts right", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  let created: Record<string, unknown> | null = null;
  await context.route(/\/v1\/customers$/, async (route) => {
    const req = route.request();
    if (fake.offline) return route.fallback();
    if (req.method() === "POST") {
      await gate;
      const body = req.postDataJSON() as { name: string };
      created = { ...CUS, id: "00000000-0000-4000-8000-000000000777", code: "C9", name: body.name, debt: 0 };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created ? [CUS, created] : [CUS]) });
  });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");

  fake.offline = true;
  await context.setOffline(true);
  await page.goto("/clientes/nuevo");
  await page.locator("#nombre").fill("Lucía Offline QA");
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).not.toBe("/clientes/nuevo");

  fake.offline = false;
  await context.setOffline(false);
  const listed = page.waitForResponse((r) => /\/v1\/customers$/.test(r.url()) && r.request().method() === "GET");
  await page.goto("/clientes");
  await listed; // the online server list replaced the local one
  await page.waitForTimeout(500);
  const main = page.locator("main");
  await expect(main.getByText("Marta Cliente QA")).toHaveCount(1, { timeout: 20_000 });
  await expect(main.getByText("Lucía Offline QA")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: /Todos/ })).toContainText("(2)");

  release();
  await expect.poll(() => created !== null, { timeout: 60_000 }).toBe(true);
  const relisted = page.waitForResponse((r) => /\/v1\/customers$/.test(r.url()) && r.request().method() === "GET");
  await page.reload();
  await relisted;
  await page.waitForTimeout(500);
  await expect(main.getByText("Marta Cliente QA")).toHaveCount(1, { timeout: 20_000 });
  await expect(main.getByText("Lucía Offline QA")).toHaveCount(1);
  await expect(page.getByRole("tab", { name: /Todos/ })).toContainText("(2)");
});
