import { expect, test } from "@playwright/test";
import { AUTH, installFakeApi, readiness } from "./fixtures";

/** loop/v1 1a: Ajustes → Portal de clientes shows the store code + absolute portal link with copy (and share when available). */
test("owner sees store code and the portal link; copy puts the absolute URL in the clipboard", async ({ context, page, baseURL }) => {
  await installFakeApi(context);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  const biz = AUTH.businessId;
  await page.goto("/mas");
  await page.getByRole("link", { name: "Portal de clientes" }).click();
  await expect(page.getByRole("heading", { name: "Portal de clientes" })).toBeVisible();
  await expect(page.getByTestId("store-code")).toHaveText(biz.slice(0, 8).toUpperCase());
  const link = `${new URL(baseURL!).origin}/cliente/login?tienda=${biz}`;
  await expect(page.getByTestId("portal-link")).toHaveText(link);
  await page.getByRole("button", { name: "Copiar enlace" }).click();
  await expect(page.getByText("Enlace copiado")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  // Share button only when the browser has navigator.share.
  const hasShare = await page.evaluate(() => typeof navigator.share === "function");
  await expect(page.getByRole("button", { name: "Compartir" })).toHaveCount(hasShare ? 1 : 0);
});

test("share button appears and shares the link when navigator.share exists", async ({ context, page }) => {
  await installFakeApi(context);
  await context.addInitScript(() => {
    (window as unknown as { __shared: unknown[] }).__shared = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: async (d: unknown) => void (window as unknown as { __shared: unknown[] }).__shared.push(d) });
  });
  await page.goto("/");
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  await page.goto("/mas/portal");
  await page.getByRole("button", { name: "Compartir" }).click();
  const shared = await page.evaluate(() => (window as unknown as { __shared: Array<{ url: string }> }).__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].url).toMatch(/\/cliente\/login\?tienda=[0-9a-f-]{36}$/);
});
