import { expect, test } from "@playwright/test";
import { installFakeApi, readiness } from "./fixtures";

/** loop/v1 A3: «Asignar a esa caja» — busy, visible error, stable requestId per intent. */
const S1 = "00000000-0000-4000-8000-000000000901";
const S2 = "00000000-0000-4000-8000-000000000902";
const MV = "00000000-0000-4000-8000-000000000911";
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const session = (id: string) => ({
  id, localDate: day, openedAt: new Date().toISOString(), openingFloat: 0, expectedEfectivo: 0, expectedNequi: 0, moveCount: 0,
  laterActivity: false, ageDays: 0, canCountClose: true, requiresCarry: false, regularized: false, closedAt: null,
});

test("assign orphan move: disabled while in flight, error shown, retry reuses key, new target mints a new key", async ({ context, page }) => {
  await installFakeApi(context);
  const keys: string[] = [];
  let release: () => void = () => undefined;
  let mode: "slow-fail" | "fail" | "ok" = "slow-fail";
  await context.route(/\/v1\/cash\/(sessions|unassigned-moves)(\?|$)/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(route.request().url().includes("unassigned") ? [{ id: MV, occurredOn: day, kind: "aporte", method: "Efectivo", amount: 5000 }] : [session(S1), session(S2)]),
    }),
  );
  await context.route(/\/v1\/cash\/moves\/[^/]+\/assign$/, async (route) => {
    keys.push((await route.request().allHeaders())["idempotency-key"] ?? "");
    if (mode === "slow-fail") await new Promise<void>((r) => (release = r));
    if (mode === "ok") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: MV, sessionId: S2 }) });
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "Algo salió mal." } }) });
  });

  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  await page.goto("/mas/caja/gestionar");
  await page.getByRole("combobox").selectOption(S1);
  const btn = page.getByRole("button", { name: "Asignar a esa caja" });
  await btn.click();
  await expect(btn).toBeDisabled();
  await btn.click({ force: true }).catch(() => undefined);
  release();
  await expect(page.getByRole("alert").filter({ hasText: "No se pudo asignar" })).toBeVisible();
  await expect(btn).toBeEnabled();
  expect(keys).toHaveLength(1);

  mode = "fail";
  await btn.click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);

  await page.getByRole("combobox").selectOption(S2);
  mode = "ok";
  await btn.click();
  await expect(page.getByText("Movimientos sin caja")).toHaveCount(0);
  expect(keys).toHaveLength(3);
  expect(keys[2]).not.toBe(keys[0]);
});
