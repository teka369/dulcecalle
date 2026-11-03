import { expect, test } from "@playwright/test";
import { installFakeApi, readiness } from "./fixtures";

/**
 * C012-INV-03 — a «rejected» trace that failed with a validation 400 also
 * gets «Reintentar respaldo» (not only discard/replace traces).
 */
const closedDay = (route: import("@playwright/test").Route) =>
  route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CLOSED_DAY", message: "La caja de ese día ya está cerrada." } }) });

test("C012-INV-03: a rejection trace that failed with 400 offers «Reintentar respaldo»", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let forbidden = true;
  const attempts: string[] = [];
  const accepted: string[] = [];
  await context.route(/\/v1\/cash\/aportes$/, async (route) => {
    if (route.request().method() !== "POST" || fake.offline) return route.fallback();
    return closedDay(route);
  });
  await context.route(/\/v1\/audit\/client-events$/, async (route) => {
    if (route.request().method() !== "POST" || fake.offline) return route.fallback();
    const body = route.request().postDataJSON() as { kind: string; operationId: string };
    attempts.push(body.kind);
    if (forbidden) {
      return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION", message: "Datos inválidos." } }) });
    }
    accepted.push(body.kind);
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: crypto.randomUUID(), ...body }) });
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
  await expect.poll(() => attempts.filter((k) => k === "rejected").length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);

  await page.goto("/sincronizacion");
  const failed = page.getByTestId("failed-backup-row");
  await expect(failed).toContainText("Rechazo sin respaldar", { timeout: 20_000 });
  await expect(failed.getByTestId("history-backup-failed")).toContainText("No se pudo respaldar: Datos inválidos.");
  forbidden = false;
  await failed.getByRole("button", { name: "Reintentar respaldo" }).click();
  await expect.poll(() => accepted.filter((k) => k === "rejected").length, { timeout: 30_000 }).toBe(1);
  await expect(page.getByTestId("failed-backup-row")).toHaveCount(0, { timeout: 15_000 });
});
