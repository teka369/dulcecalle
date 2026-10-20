import { expect, test } from "@playwright/test";
import { installFakeApi } from "./fixtures";
import { warmUp } from "./loop-v1-helpers";

/** loop/v1 pass2 D9: Caja offline says «Sin conexión» once and has no Reintentar until back online. */
test("caja offline: «Sin conexión» once, no Reintentar offline, Reintentar back when online", async ({ context, page: prep }) => {
  const fake = await installFakeApi(context);
  await warmUp(prep);
  await prep.close();
  fake.offline = true;
  await context.setOffline(true);
  const page = await context.newPage();
  await page.goto("/mas/caja");
  await expect(page.getByRole("heading", { level: 1, name: "Caja" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  const count = await page.evaluate(() => (document.body.innerText.match(/Sin conexión/g) ?? []).length);
  console.log(`D9 «Sin conexión» occurrences offline: ${count}`);
  if (count !== 1) console.log(await page.evaluate(() => document.body.innerText));
  expect(count).toBe(1);
  await expect(page.getByRole("button", { name: "Reintentar" })).toHaveCount(0);

  fake.offline = false;
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Reintentar" }).or(page.getByText("Efectivo esperado")).or(page.getByRole("button", { name: "Abrir caja" })).first()).toBeVisible({ timeout: 15_000 });
});
