import { expect, test, type Page } from "@playwright/test";
import { installFakeApi } from "./fixtures";
import { warmUp } from "./loop-v1-helpers";

/**
 * loop/v1: a rejected amount (decimals typed key by key, or above 100M) keeps exactly
 * what was typed, shows the error, and the form sends nothing — neither "" / 0 nor a stale value.
 */
async function typeInto(page: Page, label: string | RegExp, text: string) {
  const f = page.getByLabel(label, { exact: typeof label === "string" });
  await f.click();
  await f.pressSequentially(text, { delay: 25 });
  await expect(f).toHaveValue(text);
  await expect(f).toHaveAttribute("aria-invalid", "true");
  return f;
}

test("nuevo producto: precio «1500,50» / «200000000» typed → kept, error, Guardar sends nothing", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await warmUp(page);
  await page.goto("/inventario/nuevo");
  await page.locator("#nombre").fill("Producto QA monto");
  for (const bad of ["1500,50", "200000000"]) {
    const f = page.getByLabel("Precio venta");
    await f.fill("2000"); // a valid value first: it must not be sent stale
    await f.fill("");
    await typeInto(page, "Precio venta", bad);
    await expect(page.getByText(/sin centavos|máximo|supera|demasiado/i).first()).toBeVisible();
    const before = fake.log.length;
    await page.getByRole("button", { name: "Guardar producto" }).click();
    await page.waitForTimeout(800);
    expect(fake.log.slice(before).filter((l) => l.startsWith("POST")), `nothing sent for ${bad}`).toEqual([]);
    await expect(page.getByText("Producto guardado")).toHaveCount(0);
    await expect(f).toHaveValue(bad);
  }
});

test("aporte: «1500,50» typed after a valid amount → kept, error, Confirmar sends nothing", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await warmUp(page);
  await page.goto("/mas/caja");
  await page.getByLabel(/Con cuánto abres/).fill("9000");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  await expect(page.getByText("Efectivo esperado").first()).toBeVisible({ timeout: 15_000 });
  await page.goto("/mas/caja/aporte");
  const monto = page.getByLabel("Monto");
  await monto.pressSequentially("1500", { delay: 25 });
  await monto.pressSequentially(",50", { delay: 25 });
  await expect(monto).toHaveValue("1500,50");
  await expect(page.getByText(/sin centavos/)).toBeVisible();
  const before = fake.cash.posts.length;
  await page.getByRole("button", { name: "Confirmar aporte" }).click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(800);
  expect(fake.cash.posts.slice(before)).toEqual([]);
  // Correct without retyping: delete «,50».
  await monto.press("End");
  for (let i = 0; i < 3; i++) await monto.press("Backspace");
  await expect(monto).toHaveValue("1500");
  await expect(page.getByText(/sin centavos/)).toHaveCount(0);
  await page.getByRole("button", { name: "Confirmar aporte" }).click();
  await expect.poll(() => fake.cash.posts.filter((p) => p.path.includes("aporte")).length, { timeout: 15_000 }).toBe(1);
});
