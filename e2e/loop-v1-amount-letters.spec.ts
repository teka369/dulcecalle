import { expect, test, type Page } from "@playwright/test";
import { C0, installFakeApi } from "./fixtures";

/**
 * loop/v1 MEDIUM: «12a» was sent as 12. Letters (anything but digits and
 * es-CO thousands dots) are rejected in every AmountField, typed key by key
 * or pasted: the text stays with the error and nothing is submitted.
 */
const ERR = /solo números/i;

async function expectRejected(page: Page, field: ReturnType<Page["getByLabel"]>, submit: string, posts: () => number) {
  await expect(field).toHaveValue("12a");
  await expect(page.getByText(ERR).first()).toBeVisible();
  const before = posts();
  await page.getByRole("button", { name: submit }).click({ force: true, timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  expect(posts(), `${submit}: no request for «12a»`).toBe(before);
  await expect(field).toHaveValue("12a");
}

test("letters in an amount are rejected (typed and pasted) in every AmountField form", async ({ context, page }) => {
  test.setTimeout(240_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await installFakeApi(context);
  let posts = 0;
  page.on("request", (r) => {
    if (r.method() !== "GET" && /\/v1\//.test(r.url())) posts += 1;
  });
  const count = () => posts;

  const forms: { path: string; label: RegExp | string; submit: string }[] = [
    { path: "/mas/caja", label: /Con cuánto abres/, submit: "Abrir caja" },
    { path: "/mas/caja/aporte", label: "Monto", submit: "Confirmar aporte" },
    { path: "/mas/caja/retiro", label: "Monto", submit: "Confirmar retiro" },
    { path: "/mas/gastos/nuevo", label: "Monto", submit: "Confirmar gasto" },
    { path: `/clientes/${C0}/abono`, label: "¿Cuánto abona?", submit: "Registrar abono" },
  ];
  for (const f of forms) {
    await page.goto(f.path);
    const field = page.getByLabel(f.label).first();
    await expect(field).toBeVisible({ timeout: 20_000 });
    // Key by key.
    await field.fill("");
    await field.pressSequentially("12a");
    await expectRejected(page, field, f.submit, count);
    // Paste.
    await field.fill("");
    await page.evaluate(() => navigator.clipboard.writeText("12a"));
    await field.focus();
    await page.keyboard.press("ControlOrMeta+V");
    await expectRejected(page, field, f.submit, count);
    // Fixing it clears the error.
    await field.fill("1.200");
    await expect(page.getByText(ERR)).toHaveCount(0);
  }
});
