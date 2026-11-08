import { expect, test } from "@playwright/test";
import { installFakeApi, PROD, readiness } from "./fixtures";

/**
 * C01.3 QA-02 — «Registrar de nuevo» must show «¿Descartar la operación
 * rechazada?» and, on Descartar, leave «Reemplaza a L-… (venta rechazada)»
 * on the new sale. The first sale is rejected (CLOSED_DAY); the replacement
 * is accepted (201).
 */
const REJECT = "La caja de ese día ya está cerrada.";
const REPLACE_ID = "00000000-0000-4000-8000-000000000777";
const closedDay = (route: import("@playwright/test").Route) =>
  route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "CLOSED_DAY", message: REJECT } }),
  });

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
}

async function paidSale(page: import("@playwright/test").Page) {
  await page.goto("/ventas/nueva").catch(() => undefined);
  await page.getByRole("button", { name: `Agregar ${PROD.name}` }).click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  await page.getByRole("button", { name: "Registrar" }).click();
}

test("Registrar de nuevo shows the discard dialog and sale-replaces after Descartar", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let acceptSales = false;
  const created: Array<Record<string, unknown>> = [];
  await context.route(/\/v1\/sales(\/[^/?]+)?$/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && /\/sales$/.test(url.pathname)) {
      if (fake.offline) return route.fallback();
      if (!acceptSales) return closedDay(route);
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
      const sale = {
        id: REPLACE_ID,
        customerId: body.customerId ?? null,
        paymentKind: body.paymentKind ?? "paid",
        method: body.method ?? "Efectivo",
        saleTotal: body.saleTotal ?? 1500,
        amountReceived: body.amountReceived ?? 1500,
        credit: 0,
        note: body.note ?? null,
        occurredOn: today,
        createdAt: new Date().toISOString(),
        lines: body.lines ?? [],
      };
      created.push(sale);
      fake.server.extraSales.push(sale);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(sale) });
    }
    if (req.method() === "GET") {
      const id = url.pathname.split("/").pop();
      const found = created.find((s) => s.id === id);
      if (found) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(found) });
      }
    }
    return route.fallback();
  });

  await ready(page);
  fake.offline = true;
  await context.setOffline(true);
  await paidSale(page);
  await expect(page.getByText(/1 guardada aquí/).first()).toBeVisible({ timeout: 15_000 });
  fake.offline = false;
  await context.setOffline(false);

  await page.goto("/ventas");
  const badge = page.getByTestId("sale-rejected-badge").first();
  await expect(badge).toHaveText("! Rechazada", { timeout: 20_000 });
  await page.locator('a[href^="/ventas/"]', { has: page.getByTestId("sale-rejected-badge") }).first().click();
  const block = page.getByTestId("sale-rejected-block");
  await expect(block).toBeVisible({ timeout: 15_000 });
  await block.getByRole("link", { name: "Registrar de nuevo" }).click();
  await expect(page).toHaveURL(/rechazada=/);
  await expect(page.getByTestId("rejected-sale-banner")).toBeVisible();

  acceptSales = true;
  await page.getByRole("button", { name: `Agregar ${PROD.name}` }).click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  await expect(page).toHaveURL(/rechazada=/);
  await page.getByRole("button", { name: "Registrar" }).click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("¿Descartar la operación rechazada?", { timeout: 15_000 });
  await dialog.getByRole("button", { name: "Descartar" }).click();

  await page.goto(`/ventas/${REPLACE_ID}`);
  await expect(page.getByTestId("sale-replaces")).toContainText("Reemplaza a", { timeout: 15_000 });
  await expect(page.getByTestId("sale-replaces")).toContainText("venta rechazada");
});
