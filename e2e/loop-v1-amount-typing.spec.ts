import { expect, test } from "@playwright/test";
import { installFakeApi } from "./fixtures";
import { warmUp } from "./loop-v1-helpers";

/** loop/v1 verify-A1-A3: typing «1500,50» key by key must be rejected (never silently 150050). */
test("amount typed key by key: «1500,50» is rejected, «1.500» is 1500", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await warmUp(page);
  await page.goto("/mas/caja");
  await page.getByLabel(/Con cuánto abres/).fill("9000");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  await expect(page.getByText("Efectivo esperado").first()).toBeVisible({ timeout: 15_000 });
  await page.goto("/mas/caja/aporte");
  const monto = page.getByLabel("Monto");
  await expect(monto).toBeVisible({ timeout: 15_000 });
  await monto.pressSequentially("1500,50", { delay: 30 });
  await expect(monto).not.toHaveValue("150050");
  await expect(page.getByText(/sin centavos/)).toBeVisible();
  await expect(monto).toHaveAttribute("aria-invalid", "true");
  const before = fake.cash.posts.length;
  await page.getByRole("button", { name: "Confirmar aporte" }).click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(500);
  expect(fake.cash.posts.slice(before).filter((p) => p.path.includes("aporte"))).toEqual([]);

  await monto.fill("");
  await monto.pressSequentially("1.500", { delay: 30 });
  await expect(page.getByText(/sin centavos/)).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmar aporte" }).click();
  await expect.poll(() => fake.cash.posts.filter((p) => p.path.includes("aporte")).length, { timeout: 15_000 }).toBe(1);
});
