import { expect, test } from "@playwright/test";
import { installFakeApi, P1, SU } from "./fixtures";
import { trackRejections, warmUp } from "./loop-v1-helpers";

/** loop/v1 verify-A1-A3: only a real 404 on the main GET says «No encontramos…»; other errors → No se pudo cargar + Reintentar. */
const CASES = [
  { kind: "producto", path: `/v1/products/${P1}$`, url: `/inventario/${P1}`, notFound: "No encontramos ese producto.", ok: "Gomitas Ácidas QA" },
  { kind: "proveedor", path: `/v1/suppliers/${SU}$`, url: `/inventario/proveedores/${SU}`, notFound: "No encontramos ese proveedor.", ok: "Distribuidora Norte QA" },
];

for (const c of CASES) {
  test(`${c.kind}: main GET 503/500/403 → error + Reintentar; 404 → «No encontramos»`, async ({ context, page }) => {
    await installFakeApi(context);
    let status = 0;
    await context.route(new RegExp(c.path), (route) =>
      status
        ? route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code: status === 404 ? "NOT_FOUND" : status === 403 ? "FORBIDDEN" : "INTERNAL", message: "x" } }) })
        : route.fallback(),
    );
    await warmUp(page);
    for (const s of [503, 500, 403]) {
      status = s;
      const p = await context.newPage();
      const errors = trackRejections(p);
      await p.goto(c.url);
      await expect(p.getByRole("button", { name: "Reintentar" }), `status ${s}`).toBeVisible({ timeout: 15_000 });
      await expect(p.getByText("No se pudo cargar.")).toBeVisible();
      await expect(p.getByText(c.notFound)).toHaveCount(0);
      if (s === 503) {
        status = 0;
        await p.getByRole("button", { name: "Reintentar" }).click();
        await expect(p.getByRole("heading", { name: c.ok })).toBeVisible({ timeout: 15_000 });
      }
      expect(errors).toEqual([]);
      await p.close();
    }
    status = 404;
    const p = await context.newPage();
    await p.goto(c.url);
    await expect(p.getByText(c.notFound)).toBeVisible({ timeout: 15_000 });
  });
}
