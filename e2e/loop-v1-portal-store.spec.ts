import { expect, test, type BrowserContext } from "@playwright/test";

test.use({ serviceWorkers: "block" });

/**
 * loop/v1 #4: a customer code in 2+ stores. Without the store link the API
 * answers the generic 401; the form then offers ONE optional store field
 * (never a list of stores) and retries with it. With the store link
 * (?tienda=<businessId>) that step never appears.
 */
const BIZ = "00000000-0000-4000-8000-0000000000b1";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "none" })}.${b64({ sub: "c1", exp: 4102444800 })}.x`;
const CME = { id: "00000000-0000-4000-8000-000000000011", code: "DC-0001", name: "Rosa", debt: 0, createdAt: new Date().toISOString() };

async function mock(context: BrowserContext) {
  const logins: Record<string, unknown>[] = [];
  await context.route(/\/v1\//, async (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^.*\/v1/, "");
    if (p === "/customer-access/login") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      logins.push(body);
      const ok = body.pin === "482913" && (body.store === "Dulcería Norte" || body.businessId === BIZ);
      return ok
        ? route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ customer: CME, business: { id: BIZ, timezone: "America/Bogota" }, accessToken: jwt, refreshToken: "r" }) })
        : route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "No pudimos identificarte." } }) });
    }
    const body = p === "/customer/me" ? CME : p === "/customer/me/ledger" ? { customer: CME, initials: [], sales: [], payments: [] } : p === "/customer/products" ? [] : {};
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return logins;
}

test("multi-store code without the store link: generic error, then one store field, retry logs in", async ({ context, page }) => {
  const logins = await mock(context);
  await page.goto("/cliente/login");
  await expect(page.getByLabel(/Tienda/)).toHaveCount(0);
  await page.getByLabel("Código de cliente").fill("DC-0001");
  await page.getByLabel("PIN").fill("482913");
  await page.getByRole("button", { name: "Consultar saldo" }).click();
  await expect(page.getByText("No pudimos identificarte.")).toBeVisible();
  const store = page.getByLabel(/Tienda/);
  await expect(store).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
  await store.fill("Dulcería Norte");
  await page.getByRole("button", { name: "Consultar saldo" }).click();
  await expect(page).toHaveURL(/\/cliente$/);
  expect(logins).toHaveLength(2);
  expect(logins[0]).toEqual({ code: "DC-0001", pin: "482913" });
  expect(logins[1]).toEqual({ code: "DC-0001", pin: "482913", store: "Dulcería Norte" });
});

test("store link (?tienda=<businessId>) sends businessId and never shows the store step", async ({ context, page }) => {
  const logins = await mock(context);
  await page.goto(`/cliente/login?tienda=${BIZ}`);
  await page.getByLabel("Código de cliente").fill("DC-0001");
  await page.getByLabel("PIN").fill("000000");
  await page.getByRole("button", { name: "Consultar saldo" }).click();
  await expect(page.getByText("No pudimos identificarte.")).toBeVisible();
  await expect(page.getByLabel(/Tienda/)).toHaveCount(0);
  await page.getByLabel("PIN").fill("482913");
  await page.getByRole("button", { name: "Consultar saldo" }).click();
  await expect(page).toHaveURL(/\/cliente$/);
  expect(logins.map((b) => b.businessId)).toEqual([BIZ, BIZ]);
  expect(logins.every((b) => !("store" in b))).toBe(true);
});
