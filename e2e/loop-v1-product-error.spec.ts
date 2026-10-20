import { expect, test } from "@playwright/test";
import { installFakeApi, P1 } from "./fixtures";
import { trackRejections, warmUp } from "./loop-v1-helpers";

/** loop/v1 A1: a non-network read error on the detail page → error + Reintentar, never an endless skeleton. */
test("A1 producto: moves 500 → error + Reintentar; retry recovers", async ({ context, page }) => {
  await installFakeApi(context);
  let fail = false;
  await context.route(new RegExp(`/v1/products/${P1}/moves`), (route) =>
    fail
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Algo salió mal." } }) })
      : route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await warmUp(page);
  fail = true;
  page = await context.newPage();
  const errors = trackRejections(page);
  await page.goto(`/inventario/${P1}`);
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("No se pudo cargar.")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("heading", { name: "Gomitas Ácidas QA" })).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});
