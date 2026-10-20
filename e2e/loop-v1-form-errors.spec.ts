import { expect, test } from "@playwright/test";
import { installFakeApi, P1 } from "./fixtures";

/**
 * loop/v1 Jefecito: inline form errors go through the user-message filter.
 * Merma «Me lo comí»: the product vanishes before confirm → the store throws
 * English «product not found» → the user reads «No encontramos ese producto.».
 * A useful Spanish server message (409 «No hay suficiente stock.») is kept.
 */
async function openMerma(context: Parameters<typeof installFakeApi>[0], page: import("@playwright/test").Page) {
  await installFakeApi(context);
  await page.goto(`/inventario/${P1}/me-lo-comi`);
  await expect(page.getByLabel("Cantidad")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Cantidad").fill("1");
}

test("Merma: 'product not found' becomes «No encontramos ese producto.»", async ({ context, page }) => {
  await openMerma(context, page);
  await context.route(new RegExp(`/v1/products/${P1}$`), (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "No encontramos eso." } }) }),
  );
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator("main")).toContainText("No encontramos ese producto.", { timeout: 15_000 });
  await expect(page.locator("main")).not.toContainText(/not found|\bproduct\b/i);
});

test("Merma: a Spanish 409 «No hay suficiente stock.» is shown as is", async ({ context, page }) => {
  await openMerma(context, page);
  await context.route(new RegExp(`/v1/products/${P1}/shrink$`), (route) =>
    route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "INSUFFICIENT_STOCK", message: "No hay suficiente stock." } }) }),
  );
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.locator("main")).toContainText("No hay suficiente stock.", { timeout: 15_000 });
});
