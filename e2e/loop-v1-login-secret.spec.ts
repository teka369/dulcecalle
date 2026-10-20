import { expect, test } from "@playwright/test";

/** Hidden shortcut: 10 taps on the logo within 2.5 s open /acceso-tienda (behavior from before 6edf276). */
test("login: 10 quick taps on the logo open /acceso-tienda; 9 do not", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const logo = page.getByRole("button", { name: "Dulce Calle", exact: true });
  await expect(logo).toBeVisible();
  for (let i = 0; i < 9; i++) await logo.click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/\/login$/);
  await logo.click();
  await expect(page).toHaveURL(/\/acceso-tienda$/);
  await expect(page.getByRole("button", { name: "Entrar a la tienda" })).toBeVisible();
});
