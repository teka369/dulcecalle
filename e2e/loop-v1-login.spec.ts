import { expect, test } from "@playwright/test";

/** loop/v1: /login — store owner entry is the primary path; the customer portal is a secondary link. */
test("login: store login form is primary, customer portal is a reachable secondary link, one h1", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Entrar a la tienda" })).toBeVisible();
  await expect(page.getByLabel(/correo/i)).toBeVisible();
  // The customer code+PIN form is no longer the main thing on this screen.
  await expect(page.getByRole("button", { name: "Consultar saldo" })).toHaveCount(0);
  const portal = page.getByRole("link", { name: /cliente/i });
  await expect(portal).toBeVisible();
  await expect(portal).toHaveAttribute("href", "/cliente/login");
  await portal.click();
  await expect(page).toHaveURL(/\/cliente\/login$/);
  await expect(page.getByRole("button", { name: "Consultar saldo" })).toBeVisible();
});
