import { expect, test } from "@playwright/test";
import { BIZ, installFakeApi, readiness } from "./fixtures";

const STALE = "No se pudo actualizar · mostrando datos de este teléfono";

test("5xx with local data: Inicio and Ventas show this phone's data + 'No se pudo actualizar'", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");

  fake.fail5xx = /^\/(sales|cash\/today|products|customers)/;
  const home = await context.newPage();
  await home.goto("/");
  await expect(home.getByText(STALE)).toBeVisible({ timeout: 15_000 });
  await expect(home.getByText("No se pudo cargar el inicio")).toHaveCount(0);
  await home.close();

  const v = await context.newPage();
  await v.goto("/ventas");
  await expect(v.getByText(STALE)).toBeVisible({ timeout: 15_000 });
  await expect(v.getByTestId("ventas-local-note")).toBeVisible();
  await expect(v.getByText("Total listado")).toHaveCount(0);
  await expect(v.getByRole("button", { name: "Reintentar" })).toHaveCount(0);
  await v.close();
});

test("5xx without local data: Inicio and Ventas show the error + Reintentar (including after sync-complete race)", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  fake.fail5xx = /^\/(sales|cash\/today|products|customers)/;
  await page.goto("/ventas");
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Total listado")).toHaveCount(0);
  await expect(page.getByText(/\$\s?0(?![\d.,])/)).toHaveCount(0);
  await page.goto("/");
  await expect(page.getByText("No se pudo cargar el inicio")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();

  // Reproduce the exact race when SalesSyncBridge's outbox flush finishes
  // after Inicio's initial 5xx read and dispatches dulcecalle:sync-complete:
  // Inicio must stay on «No se pudo cargar el inicio» + Reintentar, never
  // revert to an infinite skeleton.
  await page.evaluate((businessId) => {
    window.dispatchEvent(new CustomEvent("dulcecalle:sync-complete", { detail: { businessId } }));
  }, BIZ);
  await page.waitForTimeout(300);
  await expect(page.getByText("No se pudo cargar el inicio")).toBeVisible({ timeout: 3_000 });
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
});

test("new device online, Ventas read times out: 'No se pudo cargar' + Reintentar, never 'Sin conexión · $0'", async ({ context, page }) => {
  await installFakeApi(context);
  await context.route(/\/v1\/sales(\?|$)/, (route) => route.abort("timedout"));
  await page.goto("/ventas");
  await expect(page.getByText("No se pudo cargar.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(page.getByText(/Sin conexión/)).toHaveCount(0);
  await expect(page.getByText(/\$\s?0(?![\d.,])/)).toHaveCount(0);
  await expect(page.getByText(/0 ventas/)).toHaveCount(0);
});
