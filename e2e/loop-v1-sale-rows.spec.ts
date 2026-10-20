import { expect, test } from "@playwright/test";
import { C0, installFakeApi, SALEO } from "./fixtures";

/** loop/v1: sale list rows and sale detail show cliente, método and fecha. */
const PAID = "00000000-0000-4000-8000-000000000551";
const PARTIAL = "00000000-0000-4000-8000-000000000552";
const paid = { ...SALEO, id: PAID, customerId: null, paymentKind: "paid", method: "Nequi", amountReceived: 3000, credit: 0 };
const partial = { ...SALEO, id: PARTIAL, customerId: C0, paymentKind: "partial", method: "Efectivo", amountReceived: 1000, credit: 2000 };
const credit = { ...SALEO, method: null };

test("ventas list + detail: cliente / método / fecha", async ({ context, page }) => {
  await installFakeApi(context);
  await context.route(/\/v1\/sales(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([paid, partial, credit]) }),
  );
  await context.route(new RegExp(`/v1/sales/${PAID}$`), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(paid) }),
  );
  await page.goto("/ventas");
  const row = (id: string) => page.locator(`a[href="/ventas/${id}"]`);
  await expect(row(PAID)).toContainText("Sin cliente", { timeout: 15_000 });
  await expect(row(PAID)).toContainText("Nequi");
  await expect(row(PARTIAL)).toContainText("Marta Cliente QA");
  await expect(row(PARTIAL)).toContainText("Efectivo + Fiado");
  await expect(row(SALEO.id)).toContainText("Fiado");
  for (const id of [PAID, PARTIAL, SALEO.id]) await expect(row(id)).toContainText(/\d{1,2} [a-z]{3}/i);

  await page.goto(`/ventas/${PAID}`);
  await expect(page.getByText("Sin cliente")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Nequi").first()).toBeVisible();
});
