import { expect, test } from "@playwright/test";
import { installFakeApi, P2 } from "./fixtures";

/**
 * loop/v1 Tester: «No se pudo cargar. product.id must be a UUID string».
 * Technical / validation text never reaches the user: a 400 with a raw
 * validator message, or a malformed 200 body, shows plain Spanish + Reintentar.
 */
const TECH = /must be|UUID|undefined|TypeError|string/i;

for (const [name, reply] of [
  ["400 with a raw validator message", { status: 400, body: { error: { code: "VALIDATION", message: "id must be a UUID" } } }],
  ["200 with a malformed body (client mapper error)", { status: 200, body: [] }],
] as const) {
  test(`Preparar: ${name} shows plain Spanish, no technical text`, async ({ context, page }) => {
    await installFakeApi(context);
    await context.route(new RegExp(`/v1/products/${P2}$`), (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) })
        : route.fallback(),
    );
    await page.goto(`/inventario/${P2}/preparar`);
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("No se pudo cargar.", { timeout: 20_000 });
    await expect(alert.getByRole("button", { name: "Reintentar" })).toBeVisible();
    await expect(page.locator("main")).not.toContainText(TECH);
  });
}
