import { expect, test } from "@playwright/test";
import { C0, installFakeApi, PROD } from "./fixtures";

/**
 * C02 / NEW-01 / NEW-02 — the Idempotency-Key is bound to the payload:
 * an unchanged retry reuses it; a changed amount/method gets a new key.
 */
const REJECT = { error: { code: "ABONO_EXCEEDS_DEBT", message: "Revisa el monto." } };

test("abono page: retry keeps the key, a changed amount gets a new key", async ({ context, page }) => {
  await installFakeApi(context);
  const keys: string[] = [];
  await context.route(/\/v1\/customers\/[^/]+\/payments$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify(REJECT) });
  });
  await page.goto(`/clientes/${C0}/abono`);
  const amount = page.getByLabel("¿Cuánto abona?");
  const submit = page.getByRole("button", { name: "Registrar abono" });
  await amount.fill("5000");
  await submit.click();
  await expect.poll(() => keys.length, { timeout: 15_000 }).toBe(1);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => keys.length).toBe(2);
  await amount.fill("7000");
  await submit.click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

test("cobrar page: retry keeps the key, a changed method gets a new key", async ({ context, page }) => {
  await installFakeApi(context);
  const keys: string[] = [];
  await context.route(/\/v1\/sales$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "INSUFFICIENT_STOCK", message: "No hay suficiente stock." } }) });
  });
  await page.goto("/ventas/nueva");
  await page.getByRole("button", { name: `Agregar ${PROD.name}` }).click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  const submit = page.getByRole("button", { name: "Registrar" });
  await submit.click();
  await expect.poll(() => keys.length, { timeout: 15_000 }).toBe(1);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect.poll(() => keys.length).toBe(2);
  await page.getByRole("radio", { name: "Nequi" }).click();
  await submit.click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});
