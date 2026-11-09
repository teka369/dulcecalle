import { expect, test } from "@playwright/test";
import { C0, CUS, installFakeApi, PROD, readiness } from "./fixtures";

/**
 * C01.1 — UI gaps of C01 found by the Tester contract and Investigador:
 * chip «Rechazada», close-caja copy (UX-C01 §7) + mark, discard warning
 * (INV-03), server trace (INV-04), «De otro día» from the real ledger shape,
 * rejected sales (UX-C01 §2/§4.3) and the «Cerrada con N sin resolver» mark (INV-05).
 */
const REJECT = "La caja de ese día ya está cerrada.";
const closedDay = (route: import("@playwright/test").Route) =>
  route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CLOSED_DAY", message: REJECT } }) });

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
}

test("rejected aporte: chip «Rechazada», close-caja copy + «Cerrar igual» mark, discard warning, server trace", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  const audit: Array<{ kind: string; operationId: string }> = [];
  const closes: Array<Record<string, unknown>> = [];
  await context.route(/\/v1\/cash\/aportes$/, async (route) => {
    if (route.request().method() !== "POST" || fake.offline) return route.fallback();
    return closedDay(route);
  });
  await context.route(/\/v1\/audit\/client-events$/, async (route) => {
    if (route.request().method() !== "POST" || fake.offline) return route.fallback();
    const body = route.request().postDataJSON() as { kind: string; operationId: string };
    audit.push(body);
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: crypto.randomUUID(), ...body }) });
  });
  await context.route(/\/v1\/cash\/sessions\/[^/]+\/close$/, async (route) => {
    if (fake.offline) return route.fallback();
    closes.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "SESSION_ALREADY_CLOSED", message: "Ya está cerrada." } }) });
  });
  await ready(page);
  await page.goto("/mas/caja");
  await page.getByLabel(/Con cuánto abres/).fill("9000");
  await page.getByRole("button", { name: "Abrir caja" }).click();
  await expect(page.locator("main")).toContainText(/9\.000/, { timeout: 15_000 });

  fake.offline = true;
  await context.setOffline(true);
  await page.locator("main").getByRole("link", { name: "Aporte", exact: true }).click();
  await page.getByLabel("Monto").fill("4700");
  await page.getByRole("button", { name: "Confirmar aporte" }).click();
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/mas/caja");
  fake.offline = false;
  await context.setOffline(false);
  await expect.poll(() => audit.filter((a) => a.kind === "rejected").length, { timeout: 60_000 }).toBe(1);

  // (a) chip «Rechazada» instead of «! Necesita atención»
  await page.goto("/sincronizacion");
  const row = page.getByTestId("sync-operations").locator("li", { hasText: "Movimiento de caja" });
  await expect(row.getByTestId("chip-rechazada")).toHaveText("! Rechazada", { timeout: 20_000 });
  await expect(row).not.toContainText("Necesita atención");
  await expect(row).toContainText(/L-\d{6}-[0-9A-Z]{4}/);

  // (d) close-caja copy (UX-C01 §7) and «Cerrar igual» carries the mark
  await page.goto("/mas/caja/cerrar");
  const card = page.getByTestId("close-rejected-card");
  await expect(card).toContainText("! Antes de cerrar", { timeout: 15_000 });
  await expect(card).toContainText("1 operación de hoy no está en el servidor: $ 4.700. Si cierras ahora, el conteo puede no cuadrar.");
  await expect(card.getByRole("link", { name: "Resolver (1)" })).toBeVisible();
  await page.getByLabel("¿Cuánto efectivo hay?").fill("13700");
  await page.getByRole("button", { name: "Cerrar caja" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("¿Cerrar la caja con 1 operación sin resolver?");
  await expect(dialog).toContainText("Quedarán marcadas en el cierre y seguirán en Pendientes. No se borra nada.");
  await dialog.getByRole("button", { name: "Cerrar igual" }).click();
  await expect.poll(() => closes.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  expect(closes[0]).toMatchObject({ unresolvedCount: 1, unresolvedAmount: 4700 });

  // INV-03 warning in the discard confirmation, then the server trace of the discard
  await page.goto("/sincronizacion");
  await row.getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByTestId("discard-attempted-warning")).toContainText("Ya se intentó enviar");
  await page.getByRole("alertdialog").getByRole("button", { name: "Descartar" }).click();
  await expect(page.getByTestId("discarded-history")).toContainText("Descartada");
  await expect.poll(() => audit.filter((a) => a.kind === "discarded").length, { timeout: 60_000 }).toBe(1);
});

test("Historial shows a discard made on another device (server trace), once", async ({ context, page }) => {
  await installFakeApi(context);
  const opId = "abcd1234-0000-4000-8000-000000000001";
  await context.route(/\/v1\/audit\/client-events$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: "e1", operationId: opId, requestId: null, entity: "customerPayment", operation: "pay", kind: "rejected", amount: 5000, customerId: null, rejectionCode: "CLOSED_DAY", lastError: REJECT, replacedBy: null, deviceCreatedAt: "2026-11-02T21:40:00.000Z", createdAt: "2026-11-02T22:00:00.000Z" },
        { id: "e2", operationId: opId, requestId: null, entity: "customerPayment", operation: "pay", kind: "discarded", amount: 5000, customerId: null, rejectionCode: "CLOSED_DAY", lastError: REJECT, replacedBy: null, deviceCreatedAt: "2026-11-02T21:40:00.000Z", createdAt: "2026-11-02T22:05:00.000Z" },
      ]),
    }),
  );
  await page.goto("/sincronizacion");
  const history = page.getByTestId("discarded-history");
  await expect(history.getByTestId("history-row")).toHaveCount(1, { timeout: 15_000 });
  await expect(history).toContainText("Descartada");
  await expect(history).toContainText("L-261102-ABCD");
  await expect(history).toContainText("Registrada en otro dispositivo");
});

test("«De otro día» shows from the real ledger shape (occurredAt + cajaDay)", async ({ context, page }) => {
  await installFakeApi(context);
  const today = new Date();
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 20, 0);
  await context.route(/\/v1\/customers\/[^/]+\/ledger$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        customer: CUS,
        initials: [{ id: "00000000-0000-4000-8000-000000000901", customerId: C0, amount: 20000, note: null, occurredOn: key(yesterday), createdAt: yesterday.toISOString() }],
        sales: [],
        payments: [{ id: "00000000-0000-4000-8000-000000000902", customerId: C0, amount: 8000, method: "Efectivo", note: null, occurredOn: key(today), occurredAt: yesterday.toISOString(), cajaDay: key(today), needsReview: false, createdAt: today.toISOString() }],
      }),
    }),
  );
  await page.goto(`/clientes/${C0}`);
  await expect(page.getByText("De otro día")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("main")).toContainText("entró a la caja del");
});

test("rejected sale: «Rechazada» + L- ref in /ventas, resolution block and «Registrar de nuevo» in the detail", async ({ context, page }) => {
  test.setTimeout(400_000);
  const fake = await installFakeApi(context);
  let salePosts = 0;
  await context.route(/\/v1\/sales$/, async (route) => {
    if (route.request().method() !== "POST" || fake.offline) return route.fallback();
    salePosts += 1;
    return closedDay(route);
  });
  await ready(page);
  fake.offline = true;
  await context.setOffline(true);
  await page.goto("/ventas/nueva").catch(() => undefined);
  await page.getByRole("button", { name: `Agregar ${PROD.name}` }).click();
  await page.getByRole("button", { name: "Cobrar" }).click();
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText(/1 guardada aquí/).first()).toBeVisible({ timeout: 15_000 });
  fake.offline = false;
  await context.setOffline(false);
  await expect.poll(() => salePosts, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);

  await page.goto("/ventas");
  const badge = page.getByTestId("sale-rejected-badge").first();
  await expect(badge).toHaveText("! Rechazada", { timeout: 20_000 });
  await expect(page.locator("main")).toContainText(/Ref\. local L-\d{6}-[0-9A-Z]{4}/);
  await page.locator('a[href^="/ventas/"]', { has: page.getByTestId("sale-rejected-badge") }).first().click();
  const block = page.getByTestId("sale-rejected-block");
  await expect(block).toContainText("El servidor no la aceptó", { timeout: 15_000 });
  await expect(block).toContainText(REJECT);
  await block.getByRole("link", { name: "Registrar de nuevo" }).click();
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toMatch(/^\/ventas\/nueva\?rechazada=/);
  await expect(page.getByTestId("rejected-sale-banner")).toContainText(`Registra de nuevo la venta de $ 1.500: ${PROD.name} ×1.`);
});

test("INV-05: closed caja shows «Cerrada con N sin resolver ($X)» in Gestionar and in Caja", async ({ context, page }) => {
  await installFakeApi(context);
  const session = { id: "00000000-0000-4000-8000-000000000990", localDate: "2026-11-02", openedAt: "2026-11-02T13:00:00.000Z", closedAt: "2026-11-02T23:00:00.000Z", openingFloat: 0, expectedEfectivo: 0, expectedNequi: 0, closingCount: 0, difference: 0, closeMode: "counted", note: null, moveCount: 0, laterActivity: false, ageDays: 1, canCountClose: false, requiresCarry: false, hasLaterOpenSession: false, regularized: true, unresolvedCount: 2, unresolvedAmount: 9500 };
  await context.route(/\/v1\/cash\/sessions(\?.*)?$/, (route) => {
    const status = new URL(route.request().url()).searchParams.get("status");
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(status === "closed" ? [session] : []) });
  });
  await page.goto("/mas/caja/gestionar");
  await page.getByRole("button", { name: /Cerradas/ }).click();
  await expect(page.locator("main")).toContainText("Cerrada con 2 sin resolver ($ 9.500)", { timeout: 15_000 });

  await context.route(/\/v1\/cash\/today$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ localDate: "2026-11-03", session: { ...session, localDate: "2026-11-03" }, expected: { efectivo: 0, nequi: 0, total: 0 }, closed: true, pendingCount: 0, pendingSessions: [], needsReviewCount: 0, conflict: false, canOpen: false, moves: [] }),
    }),
  );
  await page.goto("/mas/caja");
  await expect(page.getByTestId("caja-unresolved-mark")).toHaveText("Cerrada con 2 sin resolver ($ 9.500)", { timeout: 15_000 });
});
