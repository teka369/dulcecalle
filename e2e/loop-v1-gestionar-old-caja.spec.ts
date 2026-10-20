import { expect, test } from "@playwright/test";
import { TODAY, installFakeApi } from "./fixtures";

/**
 * loop/v1 Tester ask (3): an old caja opened a previous day and never closed.
 * Caja shows the pending notice + «Gestionar cajas» link; Gestionar lists it
 * under Pendientes with its day/age; its detail shows base, moves and the
 * close form; «Cerrar contando» closes it and it moves to Cerradas.
 */
const OLD = "00000000-0000-4000-8000-000000000931";
const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(d);
const oldDay = ymd(new Date(Date.now() - 3 * 86_400_000));
const openedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
const moves = [
  { id: "00000000-0000-4000-8000-000000000941", kind: "venta", method: "Efectivo", amount: 7000, direction: "in", occurredOn: oldDay },
  { id: "00000000-0000-4000-8000-000000000942", kind: "gasto", method: "Efectivo", amount: 2000, direction: "out", occurredOn: oldDay },
];

test("old unclosed caja: notice + link, listed as pending, detail correct, close by counting works", async ({ context, page }) => {
  await installFakeApi(context);
  let closed = false;
  let closeBody: unknown = null;
  const row = () => ({
    id: OLD, localDate: oldDay, openedAt, openingFloat: 20000, expectedEfectivo: 25000, expectedNequi: 0, moveCount: 2,
    laterActivity: false, ageDays: 3, canCountClose: true, requiresCarry: false, regularized: closed, closedAt: closed ? new Date().toISOString() : null,
  });
  await context.route(/\/v1\/cash\/today(\?|$)/, (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ...TODAY, pendingCount: closed ? 0 : 1, pendingSessions: closed ? [] : [{ id: OLD, localDate: oldDay, openedAt, openingFloat: 20000 }] }),
    }),
  );
  await context.route(/\/v1\/cash\/sessions(\?|$)/, (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    const list = status === "open" ? (closed ? [] : [row()]) : status === "closed" ? (closed ? [row()] : []) : [row()];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(list) });
  });
  await context.route(/\/v1\/cash\/unassigned-moves(\?|$)/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await context.route(new RegExp(`/v1/cash/sessions/${OLD}$`), (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ...row(), hasLaterOpenSession: false, closeMode: null, note: null, moves, stampedMoves: [] }),
    }),
  );
  await context.route(new RegExp(`/v1/cash/sessions/${OLD}/close$`), async (route) => {
    closeBody = route.request().postDataJSON();
    closed = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...row(), closingCount: 25000, difference: 0 }) });
  });

  await page.goto("/mas/caja");
  await expect(page.getByText("Tienes una caja pendiente de gestionar")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: "Gestionar cajas" }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe("/mas/caja/gestionar");
  await expect(page.getByText("Pendientes (1)")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("1 pendiente", { exact: true })).toBeVisible();
  const pendingRow = page.locator(`a[href="/mas/caja/gestionar/${OLD}"]`);
  await expect(pendingRow).toContainText("Caja del");
  await expect(pendingRow).toContainText(String(Number(oldDay.slice(8))));

  await pendingRow.click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/mas/caja/gestionar/${OLD}`);
  await expect(page.locator("main")).toContainText(/Efectivo inicial \$\s?20\.000 · 2 movimientos/, { timeout: 15_000 });
  await expect(page.getByText("Movimientos de esta caja")).toBeVisible();
  await expect(page.locator("main")).toContainText(/7\.000/);
  await expect(page.locator("main")).toContainText(/2\.000/);
  await page.getByRole("button", { name: "Cerrar contando" }).last().click();
  await expect.poll(() => closeBody, { timeout: 15_000 }).toMatchObject({ countedEfectivo: 25000 });
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/mas/caja/gestionar");
  await expect(page.getByText("Cerradas (1)")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Pendientes (0)")).toBeVisible();
  await expect(page.getByText("No hay cajas pendientes.")).toBeVisible();
  await expect(page.locator(`a[href="/mas/caja/gestionar/${OLD}"]`)).toHaveCount(0);
  await page.goto("/mas/caja");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("Tienes una caja pendiente de gestionar")).toHaveCount(0, { timeout: 15_000 });
});
