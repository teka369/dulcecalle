import { expect, test } from "@playwright/test";
import { C0, CSESS, CUS, INSUMO, P1, P2, PROD, SALE, SU, SUP, installFakeApi, readiness } from "./fixtures";

/** route, text that proves the entity's Dexie data rendered */
const ROUTES: Array<{ path: string; data: string | RegExp; kind: "entity" | "gestionar"; button?: string }> = [
  { path: `/clientes/${C0}`, data: CUS.name, kind: "entity" },
  { path: `/clientes/${C0}/abono`, data: CUS.name, kind: "entity" },
  { path: `/clientes/${C0}/deuda-inicial`, data: "Necesitas internet para registrar deuda inicial", kind: "entity", button: "Volver al cliente" },
  { path: `/ventas/${SALE}`, data: PROD.name, kind: "entity" },
  { path: `/ventas/${SALE}/devolver`, data: PROD.name, kind: "entity" },
  { path: `/inventario/${P1}`, data: PROD.name, kind: "entity" },
  { path: `/inventario/${P1}/surtir`, data: PROD.name, kind: "entity" },
  { path: `/inventario/${P2}/preparar`, data: INSUMO.name, kind: "entity" },
  { path: `/inventario/${P1}/me-lo-comi`, data: PROD.name, kind: "entity" },
  { path: `/inventario/${P1}/regalo`, data: PROD.name, kind: "entity" },
  { path: `/inventario/${P1}/perdido`, data: PROD.name, kind: "entity" },
  { path: `/inventario/proveedores/${SU}`, data: SUP.name, kind: "entity" },
  { path: "/mas/caja/gestionar", data: "Necesitas internet para gestionar cajas", kind: "gestionar" },
  { path: `/mas/caja/gestionar/${CSESS}`, data: "Necesitas internet para gestionar cajas", kind: "gestionar" },
];

const results: string[] = [];

test("full PREP, then offline cold loads of never-visited entity URLs keep the URL and show Dexie data", async ({ context, page, baseURL }) => {
  const fake = await installFakeApi(context);

  // 1. Online: SW takes control, PREP runs to ready (real downloads via the fake API).
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  const visited = fake.log.filter((l) => /\/(products|customers|suppliers|sales)\/[0-9a-f-]{36}$/.test(l));
  expect(visited, "PREP must not fetch per-entity documents").toEqual([]);
  await page.close();

  // 2. Offline: cold load each URL in a brand-new page (direct URL).
  fake.offline = true;
  await context.setOffline(true);

  for (const r of ROUTES) {
    const p = await context.newPage();
    await p.goto(r.path);
    const check = async (label: string) => {
      const scope = r.kind === "entity" ? p.getByTestId("entity-view") : p.locator("main");
      await expect(scope.getByText(r.data, { exact: false }).first(), `${label} ${r.path}`).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => new URL(p.url()).pathname, { message: `${label} url ${r.path}` }).toBe(r.path);
      // settle: Next's router must not rewrite the URL afterwards
      await p.waitForTimeout(800);
      expect(new URL(p.url()).pathname, `${label} url after settle`).toBe(r.path);
      await expect(p.getByText("Puedes seguir trabajando. Lo que guardes")).toHaveCount(0);
      if (r.kind === "entity") {
        // Designer (b): the record's view owns the screen; the list underneath is not visible.
        await expect(p.locator("main")).toBeHidden();
        await expect(scope.locator("h1").first()).toBeAttached();
        if (r.button) await expect(scope.getByRole("button", { name: r.button }).last()).toBeVisible();
      } else {
        await expect(p.getByRole("link", { name: "Volver a Caja" }).last()).toBeVisible();
      }
    };
    await check("cold");
    await p.screenshot({ path: `test-results/cold-${r.path.replaceAll("/", "_")}.png` });
    await p.reload();
    await check("reload");
    results.push(`${r.path} -> ${new URL(p.url()).pathname} -> data OK`);
    await p.close();
  }
  console.log(`E2E (${baseURL})\n` + results.join("\n"));
});
