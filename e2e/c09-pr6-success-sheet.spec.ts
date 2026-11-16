import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { C0, CUS, installFakeApi, PROD, readiness, type Fake } from "./fixtures";

/**
 * C09-PR6 — hoja de éxito con «Compartir comprobante» (SPEC-C09 §5.1, §11.2-3,
 * WIRES-C09 W2, T21) and DC-08 («Venta registrada» was unmounted by the
 * /ventas/cobrar → /ventas/nueva → / bounce 700 ms after saving).
 * Fictitious data only.
 */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const RID = (n: number) => `00000000-0000-4000-8000-${String(9000 + n).padStart(12, "0")}`;
const LINK_URL = "https://dulcecalle.vercel.app/cliente/comprobante/tok_QA-123";

type Seen = { linkPosts: Array<{ path: string; key: string | null }> };

async function serverSales(context: BrowserContext, fake: Fake): Promise<Seen> {
  const seen: Seen = { linkPosts: [] };
  let n = 125;
  await context.route(/\/v1\/sales$/, async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || fake.offline) return route.fallback();
    const body = (req.postDataJSON() ?? {}) as { customerId?: string | null; paymentKind?: string; method?: string; lines?: Array<{ id?: string; productId: string; qty: number; unitPrice?: number }> };
    const lines = (body.lines ?? []).map((l, i) => ({ id: l.id ?? RID(50 + i), productId: l.productId, productName: PROD.name, qty: l.qty, unitPrice: l.unitPrice ?? PROD.price, unitCost: 400, lineTotal: l.qty * (l.unitPrice ?? PROD.price) }));
    const total = lines.reduce((a, l) => a + l.lineTotal, 0);
    const number = `DC-000${n++}`;
    const credit = body.paymentKind === "credit" ? total : 0;
    const sale = {
      id: RID(n), number, customerId: body.customerId ?? null, paymentKind: body.paymentKind ?? "paid", method: body.method ?? "Efectivo",
      saleTotal: total, amountReceived: total - credit, credit, note: null, occurredOn: today, createdAt: new Date().toISOString(), lines,
      receipts: [{ id: RID(n + 20), kind: "sale", number, verifyCode: "ABCD234567" }],
    };
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(sale) });
  });
  await context.route(/\/v1\/receipts\/[^/]+\/links$/, async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || fake.offline) return route.fallback();
    const path = new URL(req.url()).pathname;
    seen.linkPosts.push({ path, key: req.headers()["idempotency-key"] ?? null });
    const expiresAt = new Date(Date.now() + 48 * 3600_000).toISOString();
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: RID(90), url: LINK_URL, path: "/cliente/comprobante/tok_QA-123", expiresAt }) });
  });
  return seen;
}

async function toCobrar(page: Page) {
  await page.getByRole("button", { name: `Agregar ${PROD.name}` }).click();
  await page.getByRole("button", { name: "Cobrar" }).click();
}

test("T21 / DC-08: after a paid sale the success sheet stays, with the number; internal receipt shares text only", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await serverSales(context, fake);
  await page.goto("/");
  let taps = 0;
  const tap = async (l: ReturnType<Page["locator"]>) => { await l.click(); taps += 1; };
  await tap(page.getByRole("link", { name: "Nueva venta" }).first());
  await tap(page.getByRole("button", { name: `Agregar ${PROD.name}` }));
  await tap(page.getByRole("button", { name: "Cobrar" }));
  await tap(page.getByRole("button", { name: "Registrar" }));
  expect(taps).toBe(4); // UX-C01 guardrail: a paid sale is still 4 taps
  const sheet = page.getByRole("dialog", { name: "Listo · DC-000125" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2_000); // DC-08: the old toast was gone by 700 ms
  await expect(sheet).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/ventas/cobrar");
  await expect(sheet.getByRole("button", { name: "Compartir texto" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Copiar enlace" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Compartir por WhatsApp" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Cerrar" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/");
});

test("fiada with a customer: «Copiar enlace» mints one 48 h link and «Compartir por WhatsApp» reuses it", async ({ context, page }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const fake = await installFakeApi(context);
  const seen = await serverSales(context, fake);
  // Never reach the real WhatsApp: stub the share target.
  await context.route(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>wa stub</p>" }));
  await page.goto("/ventas/nueva");
  await toCobrar(page);
  await page.getByRole("radio", { name: "Fiada" }).click();
  await page.locator('button[aria-labelledby="cliente-label"]').click();
  await page.getByRole("dialog", { name: "Selecciona cliente" }).getByRole("button", { name: new RegExp(CUS.name) }).click();
  await page.getByRole("button", { name: "Registrar" }).click();
  const sheet = page.getByRole("dialog", { name: "Listo · DC-000125" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText("El enlace sirve una vez por 48 horas y pide el PIN del cliente.");
  await sheet.getByRole("button", { name: "Copiar enlace" }).click();
  await expect(sheet).toContainText("Enlace copiado", { timeout: 15_000 });
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LINK_URL);
  expect(seen.linkPosts).toHaveLength(1);
  expect(seen.linkPosts[0]!.path).toMatch(new RegExp(`/receipts/${RID(146)}/links$`));
  expect(seen.linkPosts[0]!.key).toBeTruthy();
  const popup = page.waitForEvent("popup");
  await sheet.getByRole("button", { name: "Compartir por WhatsApp" }).click();
  const wa = await popup;
  await wa.waitForURL(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//, { timeout: 15_000 });
  const href = wa.url();
  expect(href.startsWith("https://wa.me/") || href.startsWith("https://api.whatsapp.com/")).toBe(true);
  expect(decodeURIComponent(href)).toContain(`Tu comprobante DC-000125: ${LINK_URL}`);
  expect(seen.linkPosts).toHaveLength(1); // the sheet reuses its link
  expect(await sheet.textContent()).not.toMatch(/reasonText/);
});

test("link creation failure is shown in plain Spanish and the sheet stays", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await serverSales(context, fake);
  await context.route(/\/v1\/receipts\/[^/]+\/links$/, (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }) }),
  );
  await page.goto("/ventas/nueva");
  await toCobrar(page);
  await page.getByRole("radio", { name: "Fiada" }).click();
  await page.locator('button[aria-labelledby="cliente-label"]').click();
  await page.getByRole("dialog", { name: "Selecciona cliente" }).getByRole("button", { name: new RegExp(CUS.name) }).click();
  await page.getByRole("button", { name: "Registrar" }).click();
  const sheet = page.getByRole("dialog", { name: /^Listo · DC-/ });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await sheet.getByRole("button", { name: "Copiar enlace" }).click();
  await expect(sheet.getByRole("alert")).toContainText("No pudimos crear el enlace. Intenta de nuevo.", { timeout: 15_000 });
  await expect(sheet).not.toContainText("boom");
});

test("«Nueva venta» in the sheet starts the next sale directly", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await serverSales(context, fake);
  await page.goto("/ventas/nueva");
  await toCobrar(page);
  await page.getByRole("button", { name: "Registrar" }).click();
  const sheet = page.getByRole("dialog", { name: /^Listo · DC-/ });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await sheet.getByRole("link", { name: "Nueva venta" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/ventas/nueva");
});

test("abono online: the sheet shows DC-P- and offers the link", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await serverSales(context, fake);
  await context.route(/\/v1\/customers\/[^/]+\/payments$/, async (route) => {
    const req = route.request();
    if (req.method() !== "POST" || fake.offline) return route.fallback();
    const body = (req.postDataJSON() ?? {}) as { amount: number; method: string };
    const p = {
      id: RID(60), number: "DC-P-000045", customerId: C0, amount: body.amount, method: body.method, note: null, occurredOn: today,
      createdAt: new Date().toISOString(), debtBefore: CUS.debt, debtAfter: CUS.debt - body.amount, allocations: [],
      receipts: [{ id: RID(61), kind: "payment", number: "DC-P-000045", verifyCode: "PQRS234567" }, { id: RID(62), kind: "allocation", number: "DC-P-000045/D1", verifyCode: "TVWX234567" }],
    };
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(p) });
  });
  await page.goto(`/clientes/${C0}/abono`);
  await page.getByLabel("¿Cuánto abona?").fill("5000");
  await page.getByRole("button", { name: "Registrar abono" }).click();
  const sheet = page.getByRole("dialog", { name: "Listo · DC-P-000045" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1_500);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Copiar enlace" })).toBeVisible();
  await sheet.getByRole("button", { name: "Cerrar" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe(`/clientes/${C0}`);
});

test("offline fiada: «Venta guardada en este teléfono», L- ref, no DC- and no link until it is sent", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  await serverSales(context, fake);
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
  fake.offline = true;
  await context.setOffline(true);
  await page.goto("/ventas/nueva").catch(() => undefined);
  await toCobrar(page);
  await page.getByRole("radio", { name: "Fiada" }).click();
  await page.locator('button[aria-labelledby="cliente-label"]').click();
  await page.getByRole("dialog", { name: "Selecciona cliente" }).getByRole("button", { name: new RegExp(CUS.name) }).click();
  await page.getByRole("button", { name: "Registrar" }).click();
  const sheet = page.getByRole("dialog", { name: "Venta guardada en este teléfono" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText(/Ref\. local L-\d{6}-[0-9A-Z]{4}/);
  await expect(sheet).toContainText("El enlace estará cuando se envíe.");
  await expect(sheet).not.toContainText("DC-");
  await expect(sheet.getByRole("button", { name: "Copiar enlace" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Compartir por WhatsApp" })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Compartir texto" })).toBeVisible();
  await expect(page.getByText(/1 guardada aquí/).first()).toBeVisible({ timeout: 15_000 }); // the pill stays honest
  fake.offline = false;
  await context.setOffline(false);
});
