import { expect, test } from "@playwright/test";
import type { BrowserContext, Page } from "@playwright/test";
import { INSUMO, installFakeApi, P1, P2, PROD } from "./fixtures";
import { warmUp } from "./loop-v1-helpers";

/** loop/v1: Surtir, Preparar and Merma follow A1 — only a real 404 says «No encontramos»; others → No se pudo cargar + Reintentar. */
const PAGES = [
  { kind: "surtir", id: P1, body: PROD, url: `/inventario/${P1}/surtir` },
  { kind: "preparar", id: P2, body: INSUMO, url: `/inventario/${P2}/preparar` },
  { kind: "merma", id: P1, body: PROD, url: `/inventario/${P1}/me-lo-comi` },
];

type Mode = number | "abort" | 0;
async function routeProduct(context: BrowserContext, c: (typeof PAGES)[number], get: () => Mode) {
  await context.route(new RegExp(`/v1/products/${c.id}$`), (route) => {
    const mode = get();
    if (mode === "abort") return route.abort("connectionreset");
    if (mode) {
      const code = mode === 404 ? "NOT_FOUND" : mode === 403 ? "FORBIDDEN" : "INTERNAL";
      return route.fulfill({ status: mode, contentType: "application/json", body: JSON.stringify({ error: { code, message: "x" } }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(c.body) });
  });
}

async function expectErrorThenRecover(p: Page, label: string, recover: () => void) {
  const errors: string[] = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await expect(p.getByRole("button", { name: "Reintentar" }), label).toBeVisible({ timeout: 15_000 });
  await expect(p.getByText("No se pudo cargar.")).toBeVisible();
  await expect(p.getByText("No encontramos ese producto.")).toHaveCount(0);
  recover();
  await p.getByRole("button", { name: "Reintentar" }).click();
  await expect(p.getByText("No se pudo cargar.")).toHaveCount(0, { timeout: 15_000 });
  await expect(p.getByText("No encontramos ese producto.")).toHaveCount(0);
  await expect(p.getByRole("heading", { level: 1 })).toBeVisible();
  expect(errors).toEqual([]);
}

for (const c of PAGES) {
  test(`${c.kind}: product GET 503/500/403 → error + Reintentar (retry recovers); 404 → «No encontramos»`, async ({ context, page }) => {
    await installFakeApi(context);
    let mode: Mode = 0;
    await routeProduct(context, c, () => mode);
    await warmUp(page);
    for (const m of [503, 500, 403] as const) {
      mode = m;
      const p = await context.newPage();
      await p.goto(c.url);
      await expectErrorThenRecover(p, `status ${m}`, () => (mode = 0));
      await p.close();
    }
    mode = 404;
    const p = await context.newPage();
    await p.goto(c.url);
    await expect(p.getByText("No encontramos ese producto.")).toBeVisible({ timeout: 15_000 });
  });

  test(`${c.kind}: network failure with nothing cached → error + Reintentar (retry recovers)`, async ({ context, page }) => {
    await installFakeApi(context);
    let mode: Mode = "abort";
    await routeProduct(context, c, () => mode);
    await page.goto(c.url);
    await expectErrorThenRecover(page, "network", () => (mode = 0));
  });
}
