import { expect, test } from "@playwright/test";
import { installFakeApi } from "./fixtures";
import { warmUp } from "./loop-v1-helpers";

/** loop/v1: CSP + frame-ancestors 'none' + X-Frame-Options DENY on pages and sw.js, and the app runs with no CSP violations. */
test("security headers on documents and sw.js; no CSP violations across main screens", async ({ context, page, request }) => {
  for (const path of ["/", "/login", "/sw.js", "/offline"]) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"], path).toContain("worker-src 'self'");
  }
  await installFakeApi(context);
  await context.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  await warmUp(page);
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const violations: string[] = [];
  for (const path of ["/", "/ventas", "/clientes", "/inventario", "/mas", "/mas/caja", "/sincronizacion", "/login", "/cliente/login"]) {
    await page.goto(path);
    await page.waitForTimeout(400);
    violations.push(...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)));
  }
  expect(violations).toEqual([]);
});
