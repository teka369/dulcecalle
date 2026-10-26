import { expect, test, type Page } from "@playwright/test";
import { BIZ, CUS, PROD, SUP, installFakeApi, readiness } from "./fixtures";

/**
 * loop/v1 MEDIO: after an offline-created product/customer/supplier syncs,
 * the open list screen (Inventario products, Clientes, Inventario proveedores)
 * must re-read after the reconnect sync so the row link switches to the server
 * id immediately, with no reload.
 */
const SERVER_PRODUCT = "00000000-0000-4000-8000-000000000888";
const SERVER_CUSTOMER = "00000000-0000-4000-8000-000000000777";
const SERVER_SUPPLIER = "00000000-0000-4000-8000-000000000666";

function aliasOf(page: Page, serverId: string) {
  return page.evaluate(
    ([biz, sid]) => {
      const map = JSON.parse(localStorage.getItem(`dulcecalle:id-alias:${biz}`) ?? "{}") as Record<string, string>;
      return Object.keys(map).find((k) => map[k] === sid) ?? null;
    },
    [BIZ, serverId] as const,
  );
}

async function ready(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
}

test("Inventario: offline-created product row links to the server id right after sync (even after an initial 503)", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let hold = true;
  let created: Record<string, unknown> | null = null;
  await context.route(/\/v1\/products(\/[^/]+)?$/, async (route) => {
    const req = route.request();
    if (fake.offline) return route.fallback();
    const path = new URL(req.url()).pathname;
    if (req.method() === "POST" && /\/products$/.test(path)) {
      if (hold) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Servicio no disponible" } }),
        });
      }
      const body = req.postDataJSON() as { name: string; price: number };
      created = { ...PROD, id: SERVER_PRODUCT, name: body.name, price: body.price, stock: 0 };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    }
    if (req.method() === "GET" && path.endsWith(`/products/${SERVER_PRODUCT}`) && created) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created) });
    }
    if (req.method() === "GET" && /\/products$/.test(path)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created ? [PROD, created] : [PROD]) });
    }
    return route.fallback();
  });
  await ready(page);

  fake.offline = true;
  await context.setOffline(true);
  await page.goto("/inventario/nuevo");
  await page.locator("#nombre").fill("Chocolatina Offline QA");
  await page.getByLabel("Precio venta").fill("2500");
  await page.getByRole("button", { name: "Guardar producto" }).click();
  await expect(page.getByRole("button", { name: "Terminar" })).toBeVisible({ timeout: 15_000 });
  await page.goto("/inventario");
  const row = page.locator("main a", { hasText: "Chocolatina Offline QA" });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  const localHref = await row.getAttribute("href");
  expect(localHref).not.toContain(SERVER_PRODUCT);

  // Online while POST /products is held with 503 (bumps backoff attempts).
  fake.offline = false;
  await context.setOffline(false);
  await page.waitForTimeout(800);
  await page.goto("/inventario");
  await page.waitForTimeout(800);

  // Release 503 hold and reconnect on the open Inventario screen.
  hold = false;
  fake.offline = true;
  await context.setOffline(true);
  await page.waitForTimeout(300);
  fake.offline = false;
  await context.setOffline(false);

  await expect.poll(() => aliasOf(page, SERVER_PRODUCT), { timeout: 10_000 }).not.toBeNull();
  const syncedAt = Date.now();
  await expect(row).toHaveAttribute("href", `/inventario/${SERVER_PRODUCT}`, { timeout: 3_000 });
  console.log(`product href switched ${Date.now() - syncedAt}ms after the alias was recorded`);
});

test("Clientes: offline-created customer row links to the server id right after sync", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let created: Record<string, unknown> | null = null;
  await context.route(/\/v1\/customers(\/[^/]+)?$/, async (route) => {
    const req = route.request();
    if (fake.offline) return route.fallback();
    const path = new URL(req.url()).pathname;
    if (req.method() === "POST" && /\/customers$/.test(path)) {
      const body = req.postDataJSON() as { name: string };
      created = { ...CUS, id: SERVER_CUSTOMER, code: "C9", name: body.name, debt: 0 };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    }
    if (req.method() === "GET" && path.endsWith(`/customers/${SERVER_CUSTOMER}`) && created) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created) });
    }
    if (req.method() === "GET" && /\/customers$/.test(path)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created ? [CUS, created] : [CUS]) });
    }
    return route.fallback();
  });
  await ready(page);

  fake.offline = true;
  await context.setOffline(true);
  await page.goto("/clientes/nuevo");
  await page.locator("#nombre").fill("Lucía Offline QA");
  await page.getByRole("button", { name: "Guardar cliente" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).not.toBe("/clientes/nuevo");
  await page.goto("/clientes");
  const row = page.locator("main a", { hasText: "Lucía Offline QA" });
  await expect(row).toHaveCount(1, { timeout: 20_000 });

  fake.offline = false;
  await context.setOffline(false);
  await expect.poll(() => aliasOf(page, SERVER_CUSTOMER), { timeout: 60_000 }).not.toBeNull();
  const syncedAt = Date.now();
  await expect(row).toHaveAttribute("href", `/clientes/${SERVER_CUSTOMER}`, { timeout: 3_000 });
  console.log(`customer href switched ${Date.now() - syncedAt}ms after the alias was recorded`);
});

test("Inventario (Proveedores): offline-created supplier row links to the server id right after sync", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let created: Record<string, unknown> | null = null;
  await context.route(/\/v1\/suppliers(\/[^/]+)?$/, async (route) => {
    const req = route.request();
    if (fake.offline) return route.fallback();
    const path = new URL(req.url()).pathname;
    if (req.method() === "POST" && /\/suppliers$/.test(path)) {
      const body = req.postDataJSON() as { name: string };
      created = { ...SUP, id: SERVER_SUPPLIER, name: body.name };
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(created) });
    }
    if (req.method() === "GET" && path.endsWith(`/suppliers/${SERVER_SUPPLIER}`) && created) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created) });
    }
    if (req.method() === "GET" && /\/suppliers$/.test(path)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(created ? [SUP, created] : [SUP]) });
    }
    return route.fallback();
  });
  await ready(page);

  fake.offline = true;
  await context.setOffline(true);
  await page.goto("/inventario/proveedores/nuevo");
  await page.locator("#nombre").fill("Proveedor Offline QA");
  await page.getByRole("button", { name: "Guardar proveedor" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).not.toBe("/inventario/proveedores/nuevo");
  await page.goto("/inventario");
  await page.getByRole("tab", { name: "Proveedores" }).click();
  const row = page.locator("main a", { hasText: "Proveedor Offline QA" });
  await expect(row).toHaveCount(1, { timeout: 20_000 });

  fake.offline = false;
  await context.setOffline(false);
  await expect.poll(() => aliasOf(page, SERVER_SUPPLIER), { timeout: 60_000 }).not.toBeNull();
  const syncedAt = Date.now();
  await expect(row).toHaveAttribute("href", `/inventario/proveedores/${SERVER_SUPPLIER}`, { timeout: 3_000 });
  console.log(`supplier href switched ${Date.now() - syncedAt}ms after the alias was recorded`);
});
