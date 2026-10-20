import { expect, test } from "@playwright/test";
import { installFakeApi } from "./fixtures";
import { warmUp } from "./loop-v1-helpers";

/** loop/v1 pass2 D7: Inicio «Ver…» links have a ≥44 px tap target. */
test("inicio: «Ver estadísticas», «Ver todos», «Ver inventario» are ≥44px tall", async ({ context, page }) => {
  await installFakeApi(context);
  await warmUp(page);
  await page.goto("/");
  for (const name of ["Ver estadísticas", "Ver todos", "Ver inventario"]) {
    const link = page.getByRole("link", { name, exact: true }).first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    const box = (await link.boundingBox())!;
    console.log(`D7 ${name}: ${Math.round(box.width)}x${Math.round(box.height)}`);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
