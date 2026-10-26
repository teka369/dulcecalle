import { expect, test } from "@playwright/test";
import { P1, PROD, installFakeApi } from "./fixtures";

/**
 * loop/v1 ALTO: on Merma (/inventario/:id/me-lo-comi) with network failure and
 * nothing cached, the full-screen Preparando overlay (fixed inset-0 z-[90])
 * covered "Reintentar" and blocked the click for the entire 4-minute timeout
 * whenever preparation failed or stalled.
 */
test("merma with network failure and empty cache: PrepModal never blocks Reintentar when prep fails", async ({ context, page }) => {
  await installFakeApi(context);
  let failNetwork = true;
  await context.route(/\/v1\/products(\/[^/?]+)?$/, (route) => {
    if (failNetwork) return route.abort("connectionreset");
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(path.endsWith(`/products/${P1}`) ? PROD : [PROD]),
    });
  });

  await page.goto(`/inventario/${P1}/me-lo-comi`);
  await expect(page.getByText("No se pudo cargar.")).toBeVisible({ timeout: 10_000 });
  // Give preparation a moment to hit the network failure and enter failed/preparing state.
  await page.waitForTimeout(1500);

  failNetwork = false;
  await page.getByRole("button", { name: "Reintentar" }).click({ timeout: 3_000 });
  await expect(page.getByText("No se pudo cargar.")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Me lo comí" })).toBeVisible();
});

test("merma with network failure and empty cache: PrepModal never blocks Reintentar when prep is slow or stuck", async ({ context, page }) => {
  await installFakeApi(context);
  let failProduct = true;
  await context.route(new RegExp(`/v1/products/${P1}$`), (route) => {
    if (failProduct) return route.abort("connectionreset");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROD) });
  });
  // Stall a preparation endpoint so prep stays in "preparing" if not dismissed.
  await context.route(/\/v1\/stats/, async (route) => {
    await new Promise((r) => setTimeout(r, 60_000));
    await route.abort("timedout").catch(() => undefined);
  });

  await page.goto(`/inventario/${P1}/me-lo-comi`);
  await expect(page.getByText("No se pudo cargar.")).toBeVisible({ timeout: 10_000 });

  failProduct = false;
  await page.getByRole("button", { name: "Reintentar" }).click({ timeout: 3_000 });
  await expect(page.getByText("No se pudo cargar.")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Me lo comí" })).toBeVisible();
});
