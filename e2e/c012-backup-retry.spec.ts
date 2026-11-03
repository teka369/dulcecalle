import { expect, test } from "@playwright/test";
import { installFakeApi, readiness } from "./fixtures";

/**
 * C01.2 / C011-INV-02 — a server trace (clientEvent) rejected with a 403 is
 * not lost: it is counted as «respaldo pendiente», the Historial row offers
 * «Reintentar respaldo», and once the server accepts it the trace is sent.
 */
const closedDay = (route: import("@playwright/test").Route) =>
  route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CLOSED_DAY", message: "La caja de ese día ya está cerrada." } }) });

test("403 on the trace: «respaldos pendientes» counter, «Reintentar respaldo» sends it once allowed", async ({ context, page }) => {
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
      return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Sin permiso." } }) });
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
  await expect(page.getByTestId("backups-pending")).toContainText("1 respaldo pendiente", { timeout: 20_000 });
  const row = page.getByTestId("sync-operations").locator("li", { hasText: "Movimiento de caja" });
  await row.getByRole("button", { name: "Descartar" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
  await expect.poll(() => attempts.filter((k) => k === "discarded").length, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);

  await page.reload();
  await expect(page.getByTestId("backups-pending")).toContainText("2 respaldos pendientes", { timeout: 20_000 });
  const history = page.getByTestId("history-row").first();
  await expect(history.getByTestId("history-backup")).toHaveText("Sin respaldar en el servidor todavía");
  await expect(history.getByTestId("history-backup-failed")).toContainText("No se pudo respaldar: Sin permiso.");

  forbidden = false;
  await history.getByRole("button", { name: "Reintentar respaldo" }).click();
  await expect.poll(() => accepted.filter((k) => k === "discarded").length, { timeout: 30_000 }).toBe(1);
  await expect(page.getByTestId("retry-backup")).toHaveCount(0, { timeout: 15_000 });
});

test("C011-INV-04: the caja detail (gestionar/[id]) shows «Cerrada con N sin resolver ($X)»", async ({ context, page }) => {
  await installFakeApi(context);
  const id = "00000000-0000-4000-8000-000000000991";
  const detail = { id, localDate: "2026-11-02", openedAt: "2026-11-02T13:00:00.000Z", closedAt: "2026-11-02T23:00:00.000Z", openingFloat: 0, expectedEfectivo: 0, expectedNequi: 0, closingCount: 0, difference: 0, closeMode: "counted", note: null, moveCount: 0, laterActivity: false, ageDays: 1, canCountClose: false, requiresCarry: false, hasLaterOpenSession: false, regularized: true, unresolvedCount: 2, unresolvedAmount: 9500, moves: [], stampedMoves: [] };
  await context.route(new RegExp(`/v1/cash/sessions/${id}$`), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail) }),
  );
  await page.goto(`/mas/caja/gestionar/${id}`);
  await expect(page.getByTestId("caja-unresolved-mark")).toHaveText("Cerrada con 2 sin resolver ($ 9.500)", { timeout: 15_000 });
});
