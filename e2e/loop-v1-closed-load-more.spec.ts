import { expect, test } from "@playwright/test";
import { installFakeApi, readiness } from "./fixtures";

/** loop/v1 #7: «Cargar más» pages closed cajas with the server cursor (GET /cash/sessions?status=closed&cursor=). */
const id = (n: number) => `00000000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`;
const closed = (n: number) => {
  const d = new Date(Date.UTC(2026, 8, 30) - n * 86_400_000).toISOString().slice(0, 10);
  return { id: id(n), localDate: d, openedAt: `${d}T12:00:00.000Z`, closedAt: `${d}T23:00:00.000Z`, openingFloat: 0, expectedEfectivo: 0, expectedNequi: 0, moveCount: 0,
    laterActivity: false, ageDays: n, canCountClose: false, requiresCarry: false, regularized: true };
};

test("closed cajas: first page of 50, «Cargar más» fetches the next page by cursor, then hides", async ({ context, page }) => {
  await installFakeApi(context);
  const calls: string[] = [];
  await context.route(/\/v1\/cash\/(sessions|unassigned-moves)(\?|$)/, (route) => {
    const url = new URL(route.request().url());
    calls.push(url.search);
    const status = url.searchParams.get("status");
    const cursor = url.searchParams.get("cursor");
    const body = url.pathname.endsWith("unassigned-moves") || status === "open"
      ? []
      : cursor === id(49)
        ? [50, 51, 52].map(closed)
        : cursor
          ? []
          : Array.from({ length: 50 }, (_, i) => closed(i));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  await page.goto("/mas/caja/gestionar");
  await page.getByRole("button", { name: /Cerradas/ }).click();
  await expect(page.getByText(/^Caja del /)).toHaveCount(50);
  await page.getByRole("button", { name: "Cargar más" }).click({ timeout: 10_000 });
  await expect(page.getByText(/^Caja del /)).toHaveCount(53);
  await expect(page.getByRole("button", { name: "Cargar más" })).toHaveCount(0);
  expect(calls.some((s) => s.includes(`cursor=${id(49)}`) && s.includes("status=closed"))).toBe(true);
});
