import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { installFakeApi, readiness, C0, type Fake } from "./fixtures";

/**
 * loop/v1 tab lock: N tabs of one context (same origin = same outbox). Queue
 * an aporte + a sale offline, go online. Exactly one tab replays the outbox
 * (each op reaches the server once); every tab refreshes only after that
 * leader's sync finishes (BroadcastChannel) and shows the new aporte/sale
 * without a reload; no tab is left with «Enviando X de Y».
 */
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const fixedBtn = (p: Page, t: string) => p.locator("div.fixed button", { hasText: t }).last();
const SLOW_MS = 1500; // server latency, so a tab that refreshes early is caught

async function slowServer(context: BrowserContext, fake: Fake) {
  const salePosts: string[] = [];
  const aportePosts: string[] = [];
  const byKey = new Map<string, Record<string, unknown>>();
  await context.route(/\/v1\/cash\/aportes$/, async (route) => {
    const req = route.request();
    if (req.method() === "POST" && !fake.offline) {
      aportePosts.push((await req.allHeaders())["idempotency-key"] ?? "?");
      await new Promise((r) => setTimeout(r, SLOW_MS));
    }
    return route.fallback();
  });
  await context.route(/\/v1\/sales$/, async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.fallback();
    if (fake.offline) return route.abort("internetdisconnected");
    const key = (await req.allHeaders())["idempotency-key"] ?? crypto.randomUUID();
    salePosts.push(key);
    await new Promise((r) => setTimeout(r, SLOW_MS));
    if (!byKey.has(key)) {
      const b = (req.postDataJSON() ?? {}) as { lines?: Array<{ productId: string; qty: number; unitPrice?: number }>; method?: string; paymentKind?: string; customerId?: string | null };
      const lines = (b.lines ?? []).map((l, i) => ({ id: `00000000-0000-4000-8000-0000000007${String(10 + i)}`, productId: l.productId, productName: "Gomitas", qty: l.qty, unitPrice: l.unitPrice ?? 1500, unitCost: 400, lineTotal: l.qty * (l.unitPrice ?? 1500) }));
      const total = lines.reduce((a, l) => a + l.lineTotal, 0);
      const sale = { id: crypto.randomUUID(), customerId: b.customerId ?? null, paymentKind: b.paymentKind ?? "paid", method: b.method ?? "Efectivo", saleTotal: total, amountReceived: total, credit: 0, note: null, occurredOn: today, createdAt: new Date().toISOString(), lines };
      byKey.set(key, sale);
      fake.server.extraSales.push(sale);
      fake.cash.moves.set(`sale-${key}`, { id: crypto.randomUUID(), amount: total, direction: "in", method: "Efectivo", kind: "venta", refType: "sale", refId: sale.id, occurredOn: today, createdAt: new Date().toISOString() });
    }
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(byKey.get(key)) });
  });
  return { salePosts, aportePosts };
}

async function mark(page: Page) {
  await page.evaluate(() => ((window as unknown as { __tab?: number }).__tab = 1));
}
const sameDoc = (page: Page) => page.evaluate(() => (window as unknown as { __tab?: number }).__tab === 1);

for (const n of [2, 4]) {
  test(`${n} tabs: one sync, each op once, every tab refreshed after the leader, no stuck progress`, async ({ context, page }) => {
    test.setTimeout(600_000);
    const fake = await installFakeApi(context);
    const srv = await slowServer(context, fake);
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => readiness(page), { timeout: 180_000, intervals: [1000] }).toBe("ready");
    await page.goto("/mas/caja");
    await page.getByLabel(/Con cuánto abres/).fill("9000");
    await page.getByRole("button", { name: "Abrir caja" }).click();
    await expect(page.locator("main")).toContainText(/9\.000/, { timeout: 15_000 });

    // Other tabs, opened while online on their screens.
    const targets = ["/", "/ventas", "/mas/caja"].slice(0, n - 1);
    const others: Page[] = [];
    for (const t of targets) {
      const p = await context.newPage();
      await p.goto(t);
      await expect(p.locator("main")).toContainText(/3\.000|9\.000/, { timeout: 30_000 });
      others.push(p);
    }

    // Offline: aporte 4.700 + a paid 1.500 sale queued in tab 1.
    fake.offline = true;
    await context.setOffline(true);
    await page.locator("main").getByRole("link", { name: "Aporte", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Aporte de capital" })).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Monto").fill("4700");
    await page.getByRole("button", { name: "Confirmar aporte" }).click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe("/mas/caja");
    await page.goto("/ventas/nueva");
    await page.getByRole("button", { name: "Agregar Gomitas" }).first().click();
    await fixedBtn(page, "Cobrar").click();
    await page.waitForTimeout(1500);
    await page.locator("main button", { hasText: "Pagada" }).first().click();
    await page.locator("main button", { hasText: "Efectivo" }).first().click();
    await fixedBtn(page, "Registrar").click();
    await page.waitForTimeout(2500);
    await page.goto("/mas/caja");
    await page.waitForTimeout(1500);
    expect(srv.aportePosts.length + srv.salePosts.length, "nothing sent offline").toBe(0);
    fake.server.extraSales.push({ id: "00000000-0000-4000-8000-000000000597", customerId: C0, paymentKind: "paid", method: "Efectivo", saleTotal: 2000, amountReceived: 2000, credit: 0, note: null, occurredOn: today, createdAt: new Date().toISOString(), lines: [] });
    const tabs: Array<[Page, string]> = [[page, "/mas/caja"], ...others.map((p, i) => [p, targets[i]] as [Page, string])];
    for (const [p] of tabs) await mark(p);

    // Online.
    fake.offline = false;
    await context.setOffline(false);
    // Caja: 9.000 + 4.700 + 1.500 = 15.200. Sales today: 3.000 + 1.500 + 2.000 = 6.500.
    for (const [p, t] of tabs) {
      await expect(p.locator("main"), `tab ${t}`).toContainText(t === "/mas/caja" ? /15\.200/ : /6\.500/, { timeout: 45_000 });
    }
    await expect.poll(() => srv.salePosts.length + srv.aportePosts.length, { timeout: 10_000 }).toBe(2);
    await new Promise((r) => setTimeout(r, 3 * SLOW_MS));
    console.log(`MULTITAB n=${n} aportePosts=${JSON.stringify(srv.aportePosts)} salePosts=${JSON.stringify(srv.salePosts)}`);
    expect(srv.aportePosts, "aporte sent exactly once").toHaveLength(1);
    expect(srv.salePosts, "sale sent exactly once").toHaveLength(1);
    for (const [p, t] of tabs) {
      expect(await sameDoc(p), `no reload in ${t}`).toBe(true);
      await expect(p.getByText(/Enviando \d+ de \d+/), `stuck progress in ${t}`).toHaveCount(0, { timeout: 15_000 });
    }
  });
}
