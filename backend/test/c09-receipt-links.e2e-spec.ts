import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { createHash, createHmac, randomUUID } from "crypto";
import { readFileSync } from "fs";
import * as bcrypt from "bcrypt";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

/**
 * C09-PR5 — 48 h receipt links + link-login (SPEC-C09 §3.4, §5, §7;
 * T5, T16, T17, T18, T26; WIRES W3/W6). The link is a shortcut into the SAME
 * portal login: PIN required, same throttle counter and limit, same bcrypt
 * rule. Only sha256(token) is stored. Fictitious data only.
 */
const PIN = "246813";
const H = 60 * 60 * 1000;
const GONE = {
  expired: "Este enlace venció. Pide uno nuevo a la tienda.",
  used: "Este enlace ya se usó. Entra con tu PIN en Mis compras.",
  revoked: "La tienda desactivó este enlace.",
};
type Owner = Awaited<ReturnType<typeof seedOwner>>;

describe("C09-PR5 receipt links and link-login", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.DISABLE_THROTTLE = "1";
    execSync(`${path.join(__dirname, "..", "node_modules", ".bin", "prisma")} migrate deploy`, {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    prisma = app.get(PrismaService);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());
  const admin = (o: { accessToken: string; business: { id: string } }) => ({ Authorization: `Bearer ${o.accessToken}`, "X-Business-Id": o.business.id });
  const post = (o: Owner, url: string, body: object, key = randomUUID()) => api().post(url).set(admin(o)).set("Idempotency-Key", key).send(body);
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const tokenOf = (url: string) => url.split("/cliente/comprobante/")[1]!;
  const linkLogin = (token: string, pin = PIN) => api().post("/v1/customer-access/link-login").send({ token, pin });
  const mkLink = (o: Owner, receiptId: string, key = randomUUID()) => post(o, `/v1/receipts/${receiptId}/links`, {}, key);

  async function customer(o: Owner, name: string) {
    const c = await post(o, "/v1/customers", { name });
    expect(c.status).toBe(201);
    expect((await api().post(`/v1/customers/${c.body.id}/pin`).set(admin(o)).send({ pin: PIN })).status).toBe(201);
    return c.body as { id: string; code: string };
  }
  async function fiada(o: Owner, customerId: string, product: string) {
    const s = await post(o, "/v1/sales", { lines: [{ productId: product, qty: 1, unitPrice: 1000 }], paymentKind: "credit", customerId, amountReceived: 0 });
    expect(s.status).toBe(201);
    return s.body.receipts[0].id as string;
  }

  let a: Owner;
  let b: Owner;
  let productA: string;
  let productB: string;
  let ana: { id: string; code: string };
  let anaB: { id: string; code: string };
  let internalReceipt: string;
  let anaBReceipt: string;
  let staff: { accessToken: string; business: { id: string } };

  beforeAll(async () => {
    a = await seedOwner(app, "c09l-a@test.co", "Tienda Enlace A");
    b = await seedOwner(app, "c09l-b@test.co", "Tienda Enlace B");
    for (const o of [a, b]) expect((await post(o, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    productA = (await post(a, "/v1/products", { name: "Bombón", price: 1000, stock: 100, avgCost: 400 })).body.id;
    productB = (await post(b, "/v1/products", { name: "Chicle", price: 1000, stock: 100, avgCost: 200 })).body.id;
    ana = await customer(a, "Ana Enlace");
    anaB = await customer(b, "Ana Otra");
    internalReceipt = (await post(a, "/v1/sales", { lines: [{ productId: productA, qty: 1, unitPrice: 1000 }], paymentKind: "paid", amountReceived: 1000, method: "Efectivo" })).body.receipts[0].id;
    anaBReceipt = await fiada(b, anaB.id, productB);
    const staffId = randomUUID();
    const email = `c09l-staff-${staffId}@test.co`;
    await prisma.user.create({ data: { id: staffId, email, passwordHash: await bcrypt.hash("password12", 12) } });
    await prisma.businessMembership.create({ data: { id: randomUUID(), businessId: a.business.id, userId: staffId, role: "staff" } });
    const sl = await api().post("/v1/auth/login").send({ email, password: "password12" });
    staff = { accessToken: sl.body.accessToken, business: { id: a.business.id } };
  }, 180000);

  it("create: owner gets {id, url, expiresAt}; 32-byte base64url token, only its sha256 stored; expires 48 h after creation", async () => {
    const rid = await fiada(a, ana.id, productA);
    const key = randomUUID();
    const r = await mkLink(a, rid, key);
    expect(r.status).toBe(201);
    expect(Object.keys(r.body).sort()).toEqual(["expiresAt", "id", "path", "url"]);
    const token = tokenOf(r.body.url);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(r.body.path).toBe(`/cliente/comprobante/${token}`);
    const row = await prisma.receiptLink.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(row.tokenHash).toBe(sha(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(48 * H);
    expect(new Date(r.body.expiresAt).getTime()).toBe(row.expiresAt.getTime());
    expect(row).toMatchObject({ businessId: a.business.id, receiptId: rid, usedAt: null, revokedAt: null, createdBy: a.user.id });
    // Missing key → 400.
    expect((await api().post(`/v1/receipts/${rid}/links`).set(admin(a)).send({})).status).toBe(400);
    // Staff may create (SPEC §7 owner/staff).
    expect((await mkLink(staff as Owner, rid)).status).toBe(201);
  });

  it("C09-PR5 (Jefecito): repeating the request (same or new Idempotency-Key) mints a NEW random link; the old one stays valid; DB keeps only hashes", async () => {
    const rid = await fiada(a, ana.id, productA);
    const key = randomUUID();
    const l1 = (await mkLink(a, rid, key)).body;
    const l2r = await mkLink(a, rid, key);
    const l3r = await mkLink(a, rid);
    expect(l2r.status).toBe(201);
    expect(l3r.status).toBe(201);
    const [t1, t2, t3] = [l1, l2r.body, l3r.body].map((l) => tokenOf(l.url));
    expect(new Set([t1, t2, t3]).size).toBe(3);
    expect(new Set([l1.id, l2r.body.id, l3r.body.id]).size).toBe(3);
    const rows = await prisma.receiptLink.findMany({ where: { receiptId: rid } });
    expect(rows).toHaveLength(3);
    for (const t of [t1, t2, t3]) {
      expect(rows.some((row) => row.tokenHash === sha(t))).toBe(true);
      expect(JSON.stringify(rows)).not.toContain(t);
    }
    // Every link works on its own (each one is single use).
    for (const t of [t1, t2, t3]) expect((await linkLogin(t)).status).toBe(201);
  });

  it("C09-PR5 (Jefecito): the token is random — no JWT-secret fallback, no RECEIPT_LINK_SECRET", async () => {
    const rid = await fiada(a, ana.id, productA);
    const l = (await mkLink(a, rid)).body;
    const token = tokenOf(l.url);
    const derived = createHmac("sha256", process.env.JWT_SECRET!).update(`dulcecalle:receipt-link:v1:${l.id}`).digest("base64url");
    expect(token).not.toBe(derived);
    const src = readFileSync(path.join(__dirname, "..", "src", "receipts", "receipt-links.service.ts"), "utf8");
    expect(src).not.toMatch(/jwt-secrets|requireJwtSecrets|JWT_SECRET|RECEIPT_LINK_SECRET|createHmac/);
    expect(src).toMatch(/randomBytes\(32\)/);
  });

  it("C09-PR5 audit: without the right PIN a used / expired / revoked link looks exactly like an unknown token (no state oracle)", async () => {
    const generic = { code: "UNAUTHORIZED", message: "No pudimos identificarte." };
    const fred = await customer(a, "Fred Enlace");
    const used = (await mkLink(a, await fiada(a, fred.id, productA))).body;
    expect((await linkLogin(tokenOf(used.url))).status).toBe(201);
    const exp = (await mkLink(a, await fiada(a, fred.id, productA))).body;
    await prisma.receiptLink.update({ where: { id: exp.id }, data: { createdAt: new Date(Date.now() - 50 * H), expiresAt: new Date(Date.now() - 2 * H) } });
    const rev = (await mkLink(a, await fiada(a, fred.id, productA))).body;
    expect((await api().post(`/v1/receipt-links/${rev.id}/revoke`).set(admin(a)).send({})).status).toBe(201);
    const unknown = await linkLogin(Buffer.alloc(32, 9).toString("base64url"), "000000");
    expect(unknown.status).toBe(401);
    for (const l of [used, exp, rev]) {
      const r = await linkLogin(tokenOf(l.url), "000000");
      expect(r.status).toBe(401);
      expect(r.body.error).toMatchObject(generic);
      expect(Object.keys(r.body.error).sort()).toEqual(Object.keys(unknown.body.error).sort());
    }
    expect((await prisma.receiptLink.findUniqueOrThrow({ where: { id: rev.id } })).usedAt).toBeNull();
    expect((await prisma.receiptLink.findUniqueOrThrow({ where: { id: exp.id } })).usedAt).toBeNull();
  });

  it("T5 / isolation: an internal receipt cannot be shared; another business's or unknown receipt → 404", async () => {
    const r = await mkLink(a, internalReceipt);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe("RECEIPT_NOT_SHAREABLE");
    expect(await prisma.receiptLink.count({ where: { receiptId: internalReceipt } })).toBe(0);
    expect((await mkLink(a, anaBReceipt)).status).toBe(404);
    expect((await mkLink(a, randomUUID())).status).toBe(404);
    expect((await api().post(`/v1/receipts/${anaBReceipt}/links`).set(admin(a)).set("X-Business-Id", b.business.id).set("Idempotency-Key", randomUUID()).send({})).status).toBe(403);
  });

  it("T16: link + correct PIN → same portal session (tokens + receiptId), detail visible, link marked used", async () => {
    const rid = await fiada(a, ana.id, productA);
    const link = (await mkLink(a, rid)).body;
    const r = await linkLogin(tokenOf(link.url));
    expect(r.status).toBe(201);
    expect(r.body.receiptId).toBe(rid);
    expect(r.body.customer).toMatchObject({ id: ana.id, code: ana.code });
    expect(r.body.business.id).toBe(a.business.id);
    expect(r.body.accessToken).toEqual(expect.any(String));
    expect(r.body.refreshToken).toEqual(expect.any(String));
    const d = await api().get(`/v1/customer/me/receipts/${rid}`).set("Authorization", `Bearer ${r.body.accessToken}`);
    expect(d.status).toBe(200);
    expect(d.body.id).toBe(rid);
    expect((await prisma.receiptLink.findUniqueOrThrow({ where: { id: link.id } })).usedAt).not.toBeNull();
    // Refresh works like any portal session.
    expect((await api().post("/v1/customer-access/refresh").send({ refreshToken: r.body.refreshToken })).status).toBe(201);
  });

  it("T17: reused / expired / revoked link → 410 / 410 / 410 with the W3 copy (no receipt data)", async () => {
    const used = (await mkLink(a, await fiada(a, ana.id, productA))).body;
    expect((await linkLogin(tokenOf(used.url))).status).toBe(201);
    const u = await linkLogin(tokenOf(used.url));
    expect(u.status).toBe(410);
    expect(u.body.error).toMatchObject({ code: "LINK_USED", message: GONE.used });

    const exp = (await mkLink(a, await fiada(a, ana.id, productA))).body;
    await prisma.receiptLink.update({ where: { id: exp.id }, data: { createdAt: new Date(Date.now() - 50 * H), expiresAt: new Date(Date.now() - 2 * H) } });
    const e = await linkLogin(tokenOf(exp.url));
    expect(e.status).toBe(410);
    expect(e.body.error).toMatchObject({ code: "LINK_EXPIRED", message: GONE.expired });

    const rev = (await mkLink(a, await fiada(a, ana.id, productA))).body;
    const rv = await api().post(`/v1/receipt-links/${rev.id}/revoke`).set(admin(a)).send({});
    expect(rv.status).toBe(201);
    expect(rv.body).toMatchObject({ id: rev.id, revokedAt: expect.any(String) });
    const r = await linkLogin(tokenOf(rev.url));
    expect(r.status).toBe(410);
    expect(r.body.error).toMatchObject({ code: "LINK_REVOKED", message: GONE.revoked });
    for (const x of [u, e, r]) {
      expect(x.body).not.toHaveProperty("accessToken");
      expect(JSON.stringify(x.body)).not.toMatch(/Ana|DC-0|receiptId/);
    }
    // A failed (gone) attempt never marks the link used.
    expect((await prisma.receiptLink.findUniqueOrThrow({ where: { id: rev.id } })).usedAt).toBeNull();
  });

  it("revoke: owner only, idempotent, tenant-scoped; owner detail lists links without the token", async () => {
    const rid = await fiada(a, ana.id, productA);
    const link = (await mkLink(a, rid)).body;
    expect((await api().post(`/v1/receipt-links/${link.id}/revoke`).set(admin(staff)).send({})).status).toBe(403);
    expect((await api().post(`/v1/receipt-links/${link.id}/revoke`).set(admin(b)).send({})).status).toBe(404);
    expect((await api().post(`/v1/receipt-links/${randomUUID()}/revoke`).set(admin(a)).send({})).status).toBe(404);
    const r1 = await api().post(`/v1/receipt-links/${link.id}/revoke`).set(admin(a)).send({});
    const r2 = await api().post(`/v1/receipt-links/${link.id}/revoke`).set(admin(a)).send({});
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r2.body.revokedAt).toBe(r1.body.revokedAt);
    const d = await api().get(`/v1/receipts/${rid}`).set(admin(a));
    expect(d.status).toBe(200);
    expect(d.body.links).toEqual([{ id: link.id, state: "revoked", createdAt: expect.any(String), expiresAt: link.expiresAt, usedAt: null, revokedAt: r1.body.revokedAt }]);
    expect(JSON.stringify(d.body.links)).not.toContain(tokenOf(link.url));
    expect(JSON.stringify(d.body.links)).not.toContain(sha(tokenOf(link.url)));
  });

  it("T26: at 47 h the link is still valid; at 49 h it is 410", async () => {
    const l47 = (await mkLink(a, await fiada(a, ana.id, productA))).body;
    const l49 = (await mkLink(a, await fiada(a, ana.id, productA))).body;
    for (const [l, ago] of [[l47, 47], [l49, 49]] as const) {
      const createdAt = new Date(Date.now() - ago * H);
      await prisma.receiptLink.update({ where: { id: l.id }, data: { createdAt, expiresAt: new Date(createdAt.getTime() + 48 * H) } });
    }
    expect((await linkLogin(tokenOf(l47.url))).status).toBe(201);
    const late = await linkLogin(tokenOf(l49.url));
    expect(late.status).toBe(410);
    expect(late.body.error.code).toBe("LINK_EXPIRED");
  });

  it("T18: wrong PIN via link → the portal's generic 401; same counter and limit as login (no new limit); failures never spend the link", async () => {
    const ceci = await customer(a, "Ceci Enlace");
    const link = (await mkLink(a, await fiada(a, ceci.id, productA))).body;
    const token = tokenOf(link.url);
    const generic = { code: "UNAUTHORIZED", message: "No pudimos identificarte." };
    // 3 wrong PINs on the normal login + 2 via the link = the 5 free attempts of IP_CODE_POLICY.
    for (let i = 0; i < 3; i++) {
      expect((await api().post("/v1/customer-access/login").send({ code: ceci.code, pin: "000000", businessId: a.business.id })).status).toBe(401);
    }
    for (let i = 0; i < 2; i++) {
      const r = await linkLogin(token, "000000");
      expect(r.status).toBe(401);
      expect(r.body.error).toMatchObject(generic);
    }
    // 6th attempt (even with the right PIN) is cooled, by link or by login.
    const cooled = await linkLogin(token);
    expect(cooled.status).toBe(429);
    expect(cooled.body.error.message).toBe("Demasiados intentos. Espera un momento.");
    expect((await api().post("/v1/customer-access/login").send({ code: ceci.code, pin: PIN, businessId: a.business.id })).status).toBe(429);
    expect((await prisma.receiptLink.findUniqueOrThrow({ where: { id: link.id } })).usedAt).toBeNull();
    // Malformed PIN → same generic 401.
    const dani = await customer(a, "Dani Enlace");
    const dl = (await mkLink(a, await fiada(a, dani.id, productA))).body;
    const bad = await linkLogin(tokenOf(dl.url), "12ab");
    expect(bad.status).toBe(401);
    expect(bad.body.error).toMatchObject(generic);
  });

  it("unknown or malformed token → the same generic 401 as a wrong PIN (no oracle); archived customer → 401; a link never crosses businesses", async () => {
    const generic = { code: "UNAUTHORIZED", message: "No pudimos identificarte." };
    const random = Buffer.alloc(32, 7).toString("base64url");
    for (const t of [random, "short", "x".repeat(43), "../../etc"]) {
      const r = await linkLogin(t);
      expect(r.status).toBe(401);
      expect(r.body.error).toMatchObject(generic);
    }
    // forbidNonWhitelisted: no businessId/code injection on link-login.
    const lb = (await mkLink(b, anaBReceipt)).body;
    expect((await api().post("/v1/customer-access/link-login").send({ token: tokenOf(lb.url), pin: PIN, businessId: a.business.id })).status).toBe(400);
    const ok = await linkLogin(tokenOf(lb.url));
    expect(ok.status).toBe(201);
    expect(ok.body.business.id).toBe(b.business.id);
    expect(ok.body.customer.id).toBe(anaB.id);
    expect(ok.body.receiptId).toBe(anaBReceipt);
    // Archived customer → generic 401, link not spent.
    const eva = await customer(a, "Eva Enlace");
    const el = (await mkLink(a, await fiada(a, eva.id, productA))).body;
    await prisma.customer.update({ where: { id: eva.id }, data: { archivedAt: new Date() } });
    const r = await linkLogin(tokenOf(el.url));
    expect(r.status).toBe(401);
    expect((await prisma.receiptLink.findUniqueOrThrow({ where: { id: el.id } })).usedAt).toBeNull();
  });

  it("single use under a race: two concurrent link-logins → exactly one 201, the other 410 LINK_USED", async () => {
    const link = (await mkLink(a, await fiada(a, ana.id, productA))).body;
    const t = tokenOf(link.url);
    const rs = await Promise.all([linkLogin(t), linkLogin(t)]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 410]);
    expect(rs.find((r) => r.status === 410)!.body.error.code).toBe("LINK_USED");
  });
});
