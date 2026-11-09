import { expect, test } from "@playwright/test";
import { installFakeApi, PROD } from "./fixtures";

/**
 * C01 (UX-C01 guardrail): a paid cash sale stays at 4 taps:
 * Nueva venta → Agregar producto → Cobrar → Registrar.
 */
test("paid sale = 4 taps", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await page.goto("/");
  let taps = 0;
  const tap = async (loc: ReturnType<typeof page.locator>) => {
    await loc.click();
    taps += 1;
  };
  await tap(page.getByRole("link", { name: "Nueva venta" }).first());
  await tap(page.getByRole("button", { name: `Agregar ${PROD.name}` }));
  await tap(page.getByRole("button", { name: "Cobrar" }));
  await tap(page.getByRole("button", { name: "Registrar" }));
  await expect.poll(() => fake.log.some((l) => /^POST .*\/sales$/.test(l)), { timeout: 15_000 }).toBe(true);
  expect(taps).toBe(4);
});
