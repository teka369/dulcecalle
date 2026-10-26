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
export const INSUMO = { ...PROD, id: P2, name: "Azúcar Insumo QA", sellable: false, kind: "combo" as const };
export const SUP = { id: SU, name: "Distribuidora Norte QA", phone: null, notes: null, createdAt: iso };
export const CUS = { id: C0, code: "C0", name: "Marta Cliente QA", phone: null, debt: 12000, archivedAt: null, createdAt: iso };
export const SALEO = {
  id: SALE, customerId: C0, paymentKind: "credit", method: "Efectivo", saleTotal: 3000, amountReceived: 0, credit: 3000, note: null,
  occurredOn: today, createdAt: iso,
  lines: [{ id: LINE, productId: P1, productName: PROD.name, qty: 2, unitPrice: 1500, unitCost: 400, lineTotal: 3000 }],
};
export const TODAY = { localDate: today, session: null, expected: { efectivo: 0, nequi: 0, total: 0 }, closed: false, pendingCount: 0, pendingSessions: [], needsReviewCount: 0, conflict: false, canOpen: true, moves: [] };
const STATS = (period: string) => ({ period, from: today, to: today, ventas: 3000, ventasCount: 1, devoluciones: 0, devolucionesCount: 0, recibido: 0, recibidoEfectivo: 0, recibidoNequi: 0, porCobrar: 3000, gaste: 0, inverti: 0, ganancia: 2200, valorInventario: 4000, stockBajo: 0, emptyPeriod: false });

/** B1/B5: minimal server-side caja with Idempotency-Key semantics. */
export type FakeCash = {
  sessions: Map<string, Record<string, unknown>>; // idempotency key -> session
  moves: Map<string, Record<string, unknown>>; // idempotency key -> move
  posts: Array<{ path: string; key: string | null }>;
  /** Server applies the next POST /cash/sessions but the response is lost (client must retry). */
  dropNextOpenResponse: boolean;
};

function cashToday(c: FakeCash) {
  const session = [...c.sessions.values()][0] ?? null;
  if (!session) return TODAY;
  const moves = [...c.moves.values()];
  let efectivo = Number(session.openingFloat);
  let nequi = 0;
  for (const m of moves) {
    const d = m.direction === "in" ? Number(m.amount) : -Number(m.amount);
    if (m.method === "Efectivo") efectivo += d;
    else nequi += d;
  }
  return { ...TODAY, session, canOpen: false, expected: { efectivo, nequi, total: efectivo + nequi }, moves };
}

function cashPost(c: FakeCash, p: string, key: string | null, body: Record<string, unknown>): unknown | undefined {
  const k = key ?? crypto.randomUUID();
  if (p === "/cash/sessions") {
    if (!c.sessions.has(k)) {
      if (c.sessions.size > 0) return undefined; // one caja per day
      c.sessions.set(k, { id: crypto.randomUUID(), localDate: today, openedAt: new Date().toISOString(), closedAt: null, openingFloat: Number(body.openingFloat ?? 0), closingCount: null, expectedEfectivo: null, expectedNequi: null, difference: null });
    }
    return c.sessions.get(k);
  }
  if (p === "/cash/aportes" || p === "/cash/retiros") {
    if (!c.moves.has(k)) {
      c.moves.set(k, { id: crypto.randomUUID(), amount: Number(body.amount), direction: p === "/cash/aportes" ? "in" : "out", method: String(body.method), kind: p === "/cash/aportes" ? "aporte" : "retiro", refType: null, refId: null, occurredOn: today, createdAt: new Date().toISOString() });
    }
    return c.moves.get(k);
  }
  return undefined;
}

let cash: FakeCash;
/** Server-side data another device may change (refresh-after-sync specs). */
export type FakeServer = { extraSales: unknown[]; ventasDelta: number };
let server: FakeServer = { extraSales: [], ventasDelta: 0 };

function respond(p: string, url: URL): unknown {
  if (p === "/products") return [PROD, INSUMO];
  if (p === `/products/${P1}`) return PROD;
  if (p === `/products/${P2}`) return INSUMO; // Preparar reads its insumo by id
  if (p.endsWith("/moves")) return [];
  if (p === "/suppliers") return [SUP];
  if (p === `/suppliers/${SU}`) return SUP;
  if (p.endsWith("/surtidas")) return [];
  if (p === "/customers") return [CUS];
  if (p === `/customers/${C0}`) return CUS;
  if (p.endsWith("/ledger")) return { customer: CUS, initials: [], sales: [SALEO], payments: [] };
  if (p === `/sales/${SALE}`) return SALEO;
  if (p.endsWith("/returns")) return [];
  if (p === "/sales") return [...server.extraSales, SALEO];
  if (p === "/cash/today") return cashToday(cash);
  if (p === "/me") return { id: AUTH.user.id, email: AUTH.user.email, memberships: [{ businessId: BIZ, role: "owner", business: { id: BIZ, name: "Tienda QA" } }] };
  if (p.startsWith("/stats")) {
    const st = STATS(url.searchParams.get("period") ?? "hoy");
    return { ...st, ventas: st.ventas + server.ventasDelta, ventasCount: st.ventasCount + server.extraSales.length };
  }
  return [];
}

export type Fake = {
  offline: boolean;
  log: string[];
  cash: FakeCash;
  /** GET paths matching this are answered only after slowMs (slow server). */
  slow: RegExp | null;
  slowMs: number;
  /** GET paths matching this answer 503 (server down while online). */
  fail5xx: RegExp | null;
  server: FakeServer;
};

/** Fake API (same approach as /workspace/qa-plans scripts): intercepts every /v1/ request. */
export async function installFakeApi(context: BrowserContext): Promise<Fake> {
  cash = { sessions: new Map(), moves: new Map(), posts: [], dropNextOpenResponse: false };
  server = { extraSales: [], ventasDelta: 0 };
  const st: Fake = { offline: false, log: [], cash, slow: null, slowMs: 0, fail5xx: null, server };
  await context.route(/\/v1\//, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/v1/, "");
    st.log.push(`${req.method()} ${p}`);
    if (st.offline) return route.abort("internetdisconnected");
    if (req.method() === "POST" && p.startsWith("/cash/")) {
      const key = (await req.allHeaders())["idempotency-key"] ?? null;
      st.cash.posts.push({ path: p, key });
      const out = cashPost(st.cash, p, key, (req.postDataJSON() ?? {}) as Record<string, unknown>);
      if (out === undefined) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "CONFLICT", message: "conflict" }) });
      if (p === "/cash/sessions" && st.cash.dropNextOpenResponse) {
        st.cash.dropNextOpenResponse = false;
        return route.abort("connectionreset");
      }
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify(out) });
    }
    if (req.method() === "GET" && st.fail5xx?.test(p)) {
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "INTERNAL", message: "Servicio no disponible" }) });
    }
    if (req.method() === "GET" && st.slow?.test(p)) await new Promise((r) => setTimeout(r, st.slowMs));
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
