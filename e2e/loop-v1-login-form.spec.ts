import { expect, test } from "@playwright/test";

/** loop/v1 pass2 L1/L2: Enter submits; the error is announced, fields are marked invalid, focus is kept. */
test("login: Enter submits, error is role=alert + aria-invalid, focus returns to Correo, «contraseña» wording", async ({ page }) => {
  let calls = 0;
  await page.route(/\/v1\/auth\/login/, (route) => {
    calls++;
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "UNAUTHORIZED", message: "Correo o clave incorrectos." }) });
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Dulce Calle", exact: true })).toBeVisible(); // 10-tap logo kept
  await page.getByLabel("Correo").fill("qa@example.invalid");
  await page.getByLabel("Contraseña").fill("mala");
  await page.getByLabel("Contraseña").press("Enter");
  const alert = page.getByRole("alert").filter({ hasText: /incorrect/ });
  await expect(alert).toBeVisible();
  expect(calls).toBe(1);
  await expect(alert).toHaveText("Correo o contraseña incorrectos.");
  await expect(page.getByLabel("Correo")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Contraseña")).toHaveAttribute("aria-invalid", "true");
  const errId = await alert.getAttribute("id");
  expect(errId).toBeTruthy();
  await expect(page.getByLabel("Correo")).toHaveAttribute("aria-describedby", errId!);
  await expect(page.getByLabel("Correo")).toBeFocused();
  // Editing clears the invalid state.
  await page.getByLabel("Correo").fill("otra@example.invalid");
  await expect(page.getByLabel("Correo")).not.toHaveAttribute("aria-invalid", "true");
});
