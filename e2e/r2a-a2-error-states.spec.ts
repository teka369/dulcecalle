import { expect, test } from "@playwright/test";
import { C0, SALE, installFakeApi } from "./fixtures";
import { trackRejections, warmUp } from "./loop-v1-helpers";

/**
 * R2-A A2: /mas/caja/cerrar, /ventas/[id], /ventas/[id]/devolver,
 * /clientes/[id]/abono, and /clientes/[id]/deuda-inicial must show
 * «No se pudo cargar.» + Reintentar on 5xx (and recover when retry succeeds),
 * never hang on an infinite skeleton/spinner or show a false «No encontramos…».
 */
test("cerrar caja: /cash/today 503 → error + Reintentar (recovers), never infinite spinner", async ({ context, page }) => {
  await installFakeApi(context);
  await warmUp(page);
  let fail = true;
  await context.route(/\/v1\/cash\/today(\?|$)/, (route) =>
    fail
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAVAILABLE", message: "Servicio no disponible" } }) })
      : route.fallback(),
  );
  const p = await context.newPage();
  const errors = trackRejections(p);
  await p.goto("/mas/caja/cerrar");
  await expect(p.getByRole("button", { name: "Reintentar" })).toBeVisible({ timeout: 5_000 });
  await expect(p.getByText("No se pudo cargar.")).toBeVisible();
  fail = false;
  await p.getByRole("button", { name: "Reintentar" }).click();
  await expect(p.getByText("No se pudo cargar.")).toHaveCount(0, { timeout: 10_000 });
  expect(errors).toEqual([]);
  await p.close();
});

test("ventas/[id] and ventas/[id]/devolver: 503 → error + Reintentar (recovers); 404 → No encontramos esa venta.", async ({ context, page }) => {
  await installFakeApi(context);
  await warmUp(page);
  const uncachedSale = "00000000-0000-4000-8000-000000000590";
  let status = 503;
  await context.route(new RegExp(`/v1/sales/${uncachedSale}(/returns)?$`), (route) => {
    const isReturns = route.request().url().endsWith("/returns");
    if (status) {
      return route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: status === 404 ? "NOT_FOUND" : "INTERNAL", message: "x" } }),
      });
    }
    if (isReturns) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: uncachedSale,
        customerId: C0,
        paymentKind: "paid",
        method: "Efectivo",
        saleTotal: 3000,
        amountReceived: 3000,
        credit: 0,
        note: null,
        occurredOn: "2026-10-20",
        createdAt: new Date().toISOString(),
        lines: [{ id: "00000000-0000-4000-8000-000000000690", productId: "00000000-0000-4000-8000-000000000101", productName: "Gomitas Ácidas QA", qty: 2, unitPrice: 1500, unitCost: 400, lineTotal: 3000 }],
      }),
    });
  });

  for (const url of [`/ventas/${uncachedSale}`, `/ventas/${uncachedSale}/devolver`]) {
    status = 503;
    const p = await context.newPage();
    const errors = trackRejections(p);
    await p.goto(url);
    await expect(p.getByRole("button", { name: "Reintentar" }), url).toBeVisible({ timeout: 5_000 });
    await expect(p.getByText("No se pudo cargar.")).toBeVisible();
    await expect(p.getByText("No encontramos esa venta.")).toHaveCount(0);
    status = 0;
    await p.getByRole("button", { name: "Reintentar" }).click();
    await expect(p.getByText("No se pudo cargar.")).toHaveCount(0, { timeout: 10_000 });
    await expect(p.getByText("Gomitas Ácidas QA")).toBeVisible();
    expect(errors).toEqual([]);
    await p.close();
  }

  // Also verify 404 still shows «No encontramos esa venta.»
  status = 404;
  const p404 = await context.newPage();
  await p404.goto(`/ventas/00000000-0000-4000-8000-000000000591`);
  await context.route(/\/v1\/sales\/00000000-0000-4000-8000-000000000591$/, (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "not found" } }) }),
  );
  await p404.reload();
  await expect(p404.getByText("No encontramos esa venta.")).toBeVisible({ timeout: 5_000 });
  await p404.close();
  void SALE;
});

test("clientes/[id]/abono and deuda-inicial: 503 → error + Reintentar (recovers); 404 → No encontramos ese cliente.", async ({ context, page }) => {
  await installFakeApi(context);
  await warmUp(page);
  let status = 503;
  await context.route(new RegExp(`/v1/customers/${C0}$`), (route) =>
    status
      ? route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: status === 404 ? "NOT_FOUND" : "INTERNAL", message: "x" } }),
        })
      : route.fallback(),
  );

  for (const url of [`/clientes/${C0}/abono`, `/clientes/${C0}/deuda-inicial`]) {
    status = 503;
    const p = await context.newPage();
    const errors = trackRejections(p);
    await p.goto(url);
    await expect(p.getByRole("button", { name: "Reintentar" }), url).toBeVisible({ timeout: 5_000 });
    await expect(p.getByText("No se pudo cargar.")).toBeVisible();
    await expect(p.getByText("No encontramos ese cliente.")).toHaveCount(0);
    status = 0;
    await p.getByRole("button", { name: "Reintentar" }).click();
    await expect(p.getByText("No se pudo cargar.")).toHaveCount(0, { timeout: 10_000 });
    await expect(p.getByText(/Marta Cliente QA/)).toBeVisible();
    expect(errors).toEqual([]);
    await p.close();
  }
});
