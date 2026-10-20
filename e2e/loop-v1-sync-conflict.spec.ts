import { expect, test } from "@playwright/test";
import { installFakeApi, readiness } from "./fixtures";

/**
 * loop/v1 conflict UI: the server permanently rejects an offline op (409).
 * The item stays in the sync center with what (op + key data), why (server
 * message) and the way out: Corregir (prefilled form) or Descartar (confirm).
 */
const REJECT = "La caja de ese día ya está cerrada.";

test("rejected offline aporte: badge, item with reason, Corregir prefilled, Descartar with confirmation", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let rejects = 0;
  await context.route(/\/v1\/cash\/aportes$/, async (route) => {
    if (route.request().method() !== "POST" || fake.offline) return route.fallback();
    rejects += 1;
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CLOSED_DAY", message: REJECT } }) });
  });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  await page.goto("/mas/caja");
  await page.getByLabel(/Con cuánto abres/).fill("9000");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  await expect(page.locator("main")).toContainText(/9\.000/, { timeout: 15_000 });

  fake.offline = true;
  await context.setOffline(true);
  await page.locator("main").getByRole("link", { name: "Aporte", exact: true }).click();
  await page.getByLabel("Monto").fill("4700");
  await page.getByRole("button", { name: "Confirmar aporte" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/mas/caja");
  fake.offline = false;
  await context.setOffline(false);
  await expect.poll(() => rejects, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);

  // Badge/notice in the shell, then the item in the sync center.
  await expect(page.getByText(/1 necesita atención/).first()).toBeVisible({ timeout: 20_000 });
  await page.goto("/sincronizacion");
  const row = page.locator("li", { hasText: "Movimiento de caja" });
  await expect(row).toContainText("Aporte");
  await expect(row).toContainText(/4\.700/);
  await expect(row).toContainText(REJECT);
  await expect(row.getByRole("link", { name: "Corregir" })).toBeVisible();
  await row.getByRole("link", { name: "Corregir" }).click({ timeout: 10_000 });
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toMatch(/^\/mas\/caja\/aporte\?monto=4700&rechazada=[0-9a-zA-Z-]+$/);
  await expect(page.getByLabel("Monto")).toHaveValue(/4\.?700/);

  // Never disappears silently: still there until discarded with confirmation.
  await page.goto("/sincronizacion");
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("¿Descartar este envío?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
  await expect(page.locator("li", { hasText: "Movimiento de caja" })).toHaveCount(0);
  expect(rejects, "a permanent rejection is not retried on its own").toBe(1);
});

/**
 * loop/v1 (Jefecito c): saving the form opened by «Corregir» asks
 * «¿Descartar la operación rechazada?»; Cancelar keeps the rejected item,
 * Descartar removes it. Only the first POST is rejected; the corrected one
 * goes through.
 */
test("Corregir → save asks to discard the rejected op: Cancelar keeps it, Descartar removes it", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let rejects = 0;
  let accepted = 0;
  await context.route(/\/v1\/cash\/aportes$/, async (route) => {
    if (route.request().method() !== "POST" || fake.offline) return route.fallback();
    if (rejects >= 1) {
      accepted += 1;
      return route.fallback();
    }
    rejects += 1;
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CLOSED_DAY", message: REJECT } }) });
  });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  await page.goto("/mas/caja");
  await page.getByLabel(/Con cuánto abres/).fill("9000");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  await expect(page.locator("main")).toContainText(/9\.000/, { timeout: 15_000 });

  fake.offline = true;
  await context.setOffline(true);
  await page.locator("main").getByRole("link", { name: "Aporte", exact: true }).click();
  await page.getByLabel("Monto").fill("4700");
  await page.getByRole("button", { name: "Confirmar aporte" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/mas/caja");
  fake.offline = false;
  await context.setOffline(false);
  await expect.poll(() => rejects, { timeout: 60_000 }).toBe(1);

  const rejected = page.locator("li", { hasText: REJECT });
  const correctAndSave = async (amount: string) => {
    await page.goto("/sincronizacion");
    await expect(rejected).toHaveCount(1, { timeout: 20_000 });
    await rejected.getByRole("link", { name: "Corregir" }).click({ timeout: 10_000 });
    await expect(page.getByLabel("Monto")).toHaveValue(/4\.?700/);
    await page.getByLabel("Monto").fill(amount);
    await page.getByRole("button", { name: "Confirmar aporte" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("¿Descartar la operación rechazada?", { timeout: 15_000 });
    return dialog;
  };

  // Path 1: Cancelar keeps the rejected op.
  let dialog = await correctAndSave("4600");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/mas/caja");
  await expect.poll(() => accepted, { timeout: 30_000 }).toBe(1);
  await page.goto("/sincronizacion");
  await expect(rejected).toHaveCount(1, { timeout: 20_000 });

  // Path 2: Descartar removes it.
  dialog = await correctAndSave("4500");
  await dialog.getByRole("button", { name: "Descartar" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/mas/caja");
  await expect.poll(() => accepted, { timeout: 30_000 }).toBe(2);
  await page.goto("/sincronizacion");
  await expect(page.locator("li", { hasText: REJECT })).toHaveCount(0, { timeout: 20_000 });
  expect(rejects, "the rejected op was never re-sent").toBe(1);
});
