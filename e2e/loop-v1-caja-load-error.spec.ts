import { expect, test } from "@playwright/test";
import { installFakeApi } from "./fixtures";

/** loop/v1 Tester MINOR: today's caja fails to load → «No se pudo cargar.» once (not title + same body). */
for (const [name, reply] of [
  ["400 with a technical message", { status: 400, body: { error: { code: "VALIDATION", message: "date must be a valid ISO 8601 date string" } } }],
  ["malformed 200 body", { status: 200, body: { nope: true } }],
] as const) {
  test(`Caja load error (${name}): «No se pudo cargar.» shown once, with Reintentar`, async ({ context, page }) => {
    await installFakeApi(context);
    await context.route(/\/v1\/cash\/today(\?|$)/, (route) =>
      route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) }),
    );
    await page.goto("/mas/caja");
    const main = page.locator("main");
    await expect(main.getByText("No se pudo cargar.").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    expect(((await main.innerText()).match(/No se pudo cargar\./g) ?? []).length).toBe(1);
    await expect(main.getByRole("button", { name: "Reintentar" })).toBeVisible();
  });
}
