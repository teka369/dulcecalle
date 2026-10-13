import { expect, test, type BrowserContext } from "@playwright/test";

test.use({ serviceWorkers: "block" });

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "none" })}.${b64({ sub: u(11), exp: 4102444800 })}.x`;
const now = new Date().toISOString();
const today = now.slice(0, 10);
const CME = { id: u(11), code: "C1", name: "Ana Pérez", debt: 30000, createdAt: now };
const LEDGER = { customer: CME, initials: [], sales: [], payments: [{ id: u(62), amount: 12000, method: "Nequi", occurredOn: today, createdAt: now }] };
const PRODUCTS = [{ id: u(1), name: "Gomitas Portal", price: 1500, available: true, images: [] }];

type Mode = "ok" | "neterr" | "5xx";

async function portal(context: BrowserContext, signedIn = true) {
  const st: { mode: Mode } = { mode: "ok" };
  await context.route(/\/v1\//, async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/v1/, "");
    if (st.mode === "neterr") return route.abort("connectionreset");
    if (st.mode === "5xx") return route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"boom"}' });
    const body = p === "/customer/me" ? CME : p === "/customer/me/ledger" ? LEDGER : p === "/customer/products" ? PRODUCTS : {};
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  if (signedIn) {
    await context.addInitScript(
      (a) => localStorage.setItem("dulcecalle.customer.auth", a),
      JSON.stringify({ accessToken: jwt, refreshToken: "r", customer: { id: CME.id, code: CME.code, name: CME.name } }),
    );
  }
  return st;
}

test("login: logo above the title, fields directly on the sheet", async ({ context, page }) => {
  await portal(context, false);
  await page.goto("/cliente/login");
  const logo = await page.getByTestId("login-logo").boundingBox();
  const title = await page.locator("h1").getByText("Dulce Calle").boundingBox();
  expect(logo && title && logo.y + logo.height <= title.y).toBe(true);
  const nested = await page.getByTestId("login-fields").evaluate((el) => {
    const hits: string[] = [];
    for (let e: Element | null = el; e && !e.className.toString().includes("rounded-t-[28px]"); e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (parseFloat(cs.borderTopWidth) > 0 || cs.boxShadow !== "none") hits.push(e.className.toString());
    }
    return hits;
  });
  expect(nested).toEqual([]);
});

test("productos/[id] without cache: online API failure -> 'No se pudo cargar' + Reintentar works", async ({ context, page }) => {
  const st = await portal(context);
  st.mode = "neterr";
  await page.goto(`/cliente/productos/${u(1)}`);
  await expect(page.getByText("No se pudo cargar")).toBeVisible();
  await expect(page.getByText("Sin conexión.")).toHaveCount(0);
  st.mode = "ok";
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.locator("h1", { hasText: "Gomitas Portal" })).toBeVisible();
});

test("API 5xx while online -> 'No se pudo cargar'; really offline -> 'Sin conexión.'", async ({ context, page }) => {
  const st = await portal(context);
  st.mode = "5xx";
  await page.goto("/cliente");
  await expect(page.getByText("No se pudo cargar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  st.mode = "neterr";
  await context.setOffline(true);
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByText("Sin conexión.").first()).toBeVisible();
  await context.setOffline(false);
});

test("perfil: dark mode switch touch target >= 44px", async ({ context, page }) => {
  await portal(context);
  await page.goto("/cliente/perfil");
  const box = await page.getByRole("switch", { name: "Modo oscuro" }).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
});

test("inicio: totals and shortcuts are divided rows in the sheet, not cards/tiles", async ({ context, page }) => {
  await portal(context);
  await page.goto("/cliente");
  const totals = page.getByRole("list", { name: "Tus totales" });
  await expect(totals.getByRole("listitem")).toHaveCount(2);
  await expect(totals).toContainText("Total abonado");
  const shortcuts = page.getByRole("list", { name: "Accesos" });
  await expect(shortcuts.getByRole("link")).toHaveCount(3);
  for (const name of ["Cuenta", "Compras", "Pagos"]) await expect(shortcuts.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  await expect(shortcuts).toHaveClass(/divide-y/);
});
