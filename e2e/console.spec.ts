import { expect, test } from "@playwright/test";
import { C0, P1, installFakeApi, readiness } from "./fixtures";

const ROUTES = ["/", "/ventas", "/clientes", "/inventario", "/mas", "/mas/caja", "/mas/gastos", "/sincronizacion", "/offline", "/acceso-tienda"];

test("B4: no hydration error (#418) on admin pages, /acceso-tienda and /offline", async ({ context, page }) => {
  await installFakeApi(context);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} ${e.message}`));
  for (const r of ROUTES) {
    await page.goto(r);
    await page.waitForTimeout(800);
  }
  expect(errors.filter((e) => /418|hydrat/i.test(e))).toEqual([]);
});

test("B8: offline session console noise", async ({ context, page }) => {
  const fake = await installFakeApi(context);
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true));
  await page.reload();
  await expect.poll(() => readiness(page), { timeout: 120_000, intervals: [1000] }).toBe("ready");
  fake.offline = true;
  await context.setOffline(true);
  const consoleErrors: string[] = [];
  const failed: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("requestfailed", (r) => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  for (const r of ["/clientes", `/clientes/${C0}`, "/inventario", `/inventario/${P1}`, "/mas/caja", "/ventas", "/"]) {
    await page.goto(r);
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(5000);
  console.log(`B8 console errors=${consoleErrors.length} failed requests=${failed.length}`);
  const byUrl = new Map<string, number>();
  for (const f of failed) {
    const key = f.replace(/[0-9a-f-]{36}/g, ":id").replace(/\?.*$/, "");
    byUrl.set(key, (byUrl.get(key) ?? 0) + 1);
  }
  console.log([...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `${n}× ${k}`).join("\n"));
  console.log(consoleErrors.slice(0, 10).join("\n"));
  expect(consoleErrors.length).toBeLessThanOrEqual(Number(process.env.B8_MAX ?? 1000));
});
