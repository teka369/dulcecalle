import type { BrowserContext, Page } from "@playwright/test";

export const BIZ = "00000000-0000-4000-8000-0000000000b1";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const P1 = id(101);
/** Insumo (sellable: false): the only kind /preparar accepts. */
export const P2 = id(102);
export const SU = id(301);
export const SALE = id(501);
export const CSESS = id(502);
export const C0 = id(701);
const LINE = id(601);

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "none" })}.${b64({ sub: id(1), exp: 4102444800 })}.x`;
export const AUTH = { accessToken: jwt, refreshToken: jwt, businessId: BIZ, user: { id: id(1), email: "qa@example.invalid" } };

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
const iso = new Date().toISOString();
export const PROD = { id: P1, name: "Gomitas Ácidas QA", category: "Dulces", price: 1500, avgCost: 400, stock: 10, lowStockAt: 2, sellable: true, archivedAt: null, createdAt: iso, images: [] };
export const INSUMO = { ...PROD, id: P2, name: "Azúcar Insumo QA", sellable: false };
export const SUP = { id: SU, name: "Distribuidora Norte QA", phone: null, notes: null, createdAt: iso };
export const CUS = { id: C0, code: "C0", name: "Marta Cliente QA", phone: null, debt: 12000, archivedAt: null, createdAt: iso };
export const SALEO = {
  id: SALE, customerId: C0, paymentKind: "credit", method: "Efectivo", saleTotal: 3000, amountReceived: 0, credit: 3000, note: null,
  occurredOn: today, createdAt: iso,
  lines: [{ id: LINE, productId: P1, productName: PROD.name, qty: 2, unitPrice: 1500, unitCost: 400, lineTotal: 3000 }],
};
const TODAY = { localDate: today, session: null, expected: { efectivo: 0, nequi: 0, total: 0 }, closed: false, pendingCount: 0, pendingSessions: [], needsReviewCount: 0, conflict: false, canOpen: true, moves: [] };
const STATS = (period: string) => ({ period, from: today, to: today, ventas: 3000, ventasCount: 1, devoluciones: 0, devolucionesCount: 0, recibido: 0, recibidoEfectivo: 0, recibidoNequi: 0, porCobrar: 3000, gaste: 0, inverti: 0, ganancia: 2200, valorInventario: 4000, stockBajo: 0, emptyPeriod: false });

function respond(p: string, url: URL): unknown {
  if (p === "/products") return [PROD, INSUMO];
  if (p === `/products/${P1}`) return PROD;
  if (p.endsWith("/moves")) return [];
  if (p === "/suppliers") return [SUP];
  if (p === `/suppliers/${SU}`) return SUP;
  if (p.endsWith("/surtidas")) return [];
  if (p === "/customers") return [CUS];
  if (p === `/customers/${C0}`) return CUS;
  if (p.endsWith("/ledger")) return { customer: CUS, initials: [], sales: [SALEO], payments: [] };
  if (p === `/sales/${SALE}`) return SALEO;
  if (p.endsWith("/returns")) return [];
  if (p === "/sales") return [SALEO];
  if (p === "/cash/today") return TODAY;
  if (p === "/me") return { id: AUTH.user.id, email: AUTH.user.email, memberships: [{ businessId: BIZ, role: "owner", business: { id: BIZ, name: "Tienda QA" } }] };
  if (p.startsWith("/stats")) return STATS(url.searchParams.get("period") ?? "hoy");
  return [];
}

export type Fake = { offline: boolean; log: string[] };

/** Fake API (same approach as /workspace/qa-plans scripts): intercepts every /v1/ request. */
export async function installFakeApi(context: BrowserContext): Promise<Fake> {
  const st: Fake = { offline: false, log: [] };
  await context.route(/\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/v1/, "");
    st.log.push(`${req.method()} ${p}`);
    if (st.offline) return route.abort("internetdisconnected");
    if (req.method() !== "GET") return route.fulfill({ status: 501, contentType: "application/json", body: "{}" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(respond(p, url)) });
  });
  await context.addInitScript((a) => localStorage.setItem("dulcecalle.auth", a), JSON.stringify(AUTH));
  return st;
}

export async function readiness(page: Page): Promise<string | null> {
  return page.evaluate(async (biz) => {
    const db = await new Promise<IDBDatabase>((ok, ko) => {
      const q = indexedDB.open("dulcecalle-local");
      q.onsuccess = () => ok(q.result);
      q.onerror = () => ko(q.error);
    });
    if (!db.objectStoreNames.contains("prepState")) return null;
    return new Promise<string | null>((ok) => {
      const q = db.transaction("prepState").objectStore("prepState").get(`readiness::${biz}`);
      q.onsuccess = () => ok((q.result as { status?: string } | undefined)?.status ?? null);
      q.onerror = () => ok(null);
    });
  }, BIZ);
}
