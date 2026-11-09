import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import { canonicalJson } from "../src/shared/canonical";
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
 * C09-PR5 — public verification GET /v1/receipts/verify/:code (SPEC-C09 §4,
 * §7; T19, T20; WIRES W5). verifyCode has ~49 bits, so the endpoint is
 * throttled per IP (10/min, own bucket), answers ONLY the §4 fields, gives
 * one identical 404 for unknown and malformed codes and takes the same time
 * either way. The Nest throttler is ON in this file (no DISABLE_THROTTLE);
 * VERIFY_THROTTLE_TTL_MS shortens the window so the reset is observable
 * (non-production only). Fictitious data only.
 */
const PIN = "246813";
const TTL = 4000; // > 11 requests × VERIFY_MIN_MS, so the window cannot slide mid-test
const FIELDS = ["amount", "businessName", "createdAt", "hashPrefix", "kind", "number", "status", "valid"];
const NOT_FOUND = { code: "NOT_FOUND", message: "No encontramos ese código. Revisa que esté bien escrito." };
type Owner = Awaited<ReturnType<typeof seedOwner>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

jest.setTimeout(60000);

describe("C09-PR5 public receipt verification", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    delete process.env.DISABLE_THROTTLE;
    process.env.VERIFY_THROTTLE_TTL_MS = String(TTL);
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
    delete process.env.VERIFY_THROTTLE_TTL_MS;
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());
  const admin = (o: Owner) => ({ Authorization: `Bearer ${o.accessToken}`, "X-Business-Id": o.business.id });
  const post = (o: Owner, url: string, body: object) => api().post(url).set(admin(o)).set("Idempotency-Key", randomUUID()).send(body);
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const verify = (code: string) => api().get(`/v1/receipts/verify/${encodeURIComponent(code)}`);
  const owner = async (o: Owner, id: string) => (await api().get(`/v1/receipts/${id}`).set(admin(o))).body;
  /** Each test starts on a fresh throttle window. */
  const fresh = () => sleep(TTL + 200);

  let a: Owner;
  let b: Owner;
  let ana: { id: string; code: string };
  let sale: { id: string; receipts: Array<{ id: string; number: string }> };
  let saleR: { verifyCode: string; number: string; contentHash: string; snapshot: unknown };
  let internalR: { verifyCode: string };
  let bR: { verifyCode: string };
  let productA: string;

  beforeAll(async () => {
    a = await seedOwner(app, "c09v-a@test.co", "Tienda Verifica A");
    b = await seedOwner(app, "c09v-b@test.co", "Tienda Verifica B");
    for (const o of [a, b]) expect((await post(o, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    productA = (await post(a, "/v1/products", { name: "Bombón", price: 1000, stock: 100, avgCost: 400 })).body.id;
    const productB = (await post(b, "/v1/products", { name: "Chicle", price: 500, stock: 100, avgCost: 200 })).body.id;
    const c = await post(a, "/v1/customers", { name: "Ana Verifica" });
    ana = c.body;
    await api().post(`/v1/customers/${ana.id}/pin`).set(admin(a)).send({ pin: PIN });
    sale = (await post(a, "/v1/sales", { lines: [{ productId: productA, qty: 3, unitPrice: 1000 }], paymentKind: "credit", customerId: ana.id, amountReceived: 0 })).body;
    saleR = await owner(a, sale.receipts[0]!.id);
    internalR = await owner(a, (await post(a, "/v1/sales", { lines: [{ productId: productA, qty: 1, unitPrice: 1000 }], paymentKind: "paid", amountReceived: 1000, method: "Efectivo" })).body.receipts[0].id);
    const cb = await post(b, "/v1/customers", { name: "Beto Verifica" });
    bR = await owner(b, (await post(b, "/v1/sales", { lines: [{ productId: productB, qty: 2, unitPrice: 500 }], paymentKind: "credit", customerId: cb.body.id, amountReceived: 0 })).body.receipts[0].id);
  }, 180000);

  beforeEach(fresh);

  it("T19: valid code, no auth → 200 with ONLY the §4 fields; no customer, lines, balance, ids or other receipts", async () => {
    const r = await verify(saleR.verifyCode);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(FIELDS);
    expect(r.body).toEqual({
      valid: true,
      kind: "sale",
      number: "DC-000001",
      amount: "3000",
      createdAt: (saleR.snapshot as { createdAt: string }).createdAt,
      businessName: "Tienda Verifica A",
      status: "vigente",
      hashPrefix: saleR.contentHash.slice(0, 8),
    });
    const text = JSON.stringify(r.body);
    for (const leak of ["Ana", ana.code, ana.id, a.business.id, sale.id, sale.receipts[0]!.id, saleR.verifyCode, "Bombón", "debt", "lines", "customer"]) {
      expect(text).not.toContain(leak);
    }
    // An owner token or tenant header adds nothing.
    const withAuth = await verify(saleR.verifyCode).set(admin(a));
    expect(withAuth.body).toEqual(r.body);
    // Manual entry XXXX-XXXX-XX, lowercase and spaces are accepted.
    const v = saleR.verifyCode;
    const pretty = `${v.slice(0, 4)}-${v.slice(4, 8)}-${v.slice(8)}`.toLowerCase();
    expect((await verify(pretty)).body).toEqual(r.body);
    expect((await verify(` ${v.slice(0, 4)} ${v.slice(4)} `)).body).toEqual(r.body);
  });

  it("integrity: hashPrefix = first 8 hex of sha256(canonical snapshot), recomputable by anyone holding the receipt", async () => {
    const r = await verify(saleR.verifyCode);
    expect(sha(canonicalJson(saleR.snapshot))).toBe(saleR.contentHash);
    expect(r.body.hashPrefix).toBe(sha(canonicalJson(saleR.snapshot)).slice(0, 8));
    expect(r.body.hashPrefix).toMatch(/^[0-9a-f]{8}$/);
  });

  it("T20: unknown and malformed codes → one identical 404 body (W5 copy), never 400; no oracle", async () => {
    const bodies: unknown[] = [];
    for (const code of ["ZZZZZZZZZZ", "2345-6789-AB", "short", "0O1IL0O1IL", "A".repeat(40), "' OR 1=1 --"]) {
      const r = await verify(code);
      expect(r.status).toBe(404);
      bodies.push(r.body);
    }
    expect(bodies[0]).toEqual({ error: NOT_FOUND });
    for (const x of bodies) expect(x).toEqual(bodies[0]);
  });

  it("T20: unknown takes the same time as valid (response floor; medians within 80 ms)", async () => {
    const time = async (code: string) => {
      const t = Date.now();
      await verify(code);
      return Date.now() - t;
    };
    const med = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;
    const ok: number[] = [];
    const miss: number[] = [];
    for (let i = 0; i < 4; i++) {
      ok.push(await time(saleR.verifyCode));
      miss.push(await time("ZZZZZZZZZZ"));
    }
    expect(Math.min(...ok, ...miss)).toBeGreaterThanOrEqual(200);
    expect(Math.abs(med(ok) - med(miss))).toBeLessThan(80);
  });

  it("T20: throttle 10/min per IP on verify: the 11th request → 429 whatever the code; it resets after the window", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await verify(i % 2 ? saleR.verifyCode : "ZZZZZZZZZZ");
      expect([200, 404]).toContain(r.status);
    }
    expect((await verify(saleR.verifyCode)).status).toBe(429);
    expect((await verify("ZZZZZZZZZZ")).status).toBe(429);
    // Own bucket: the portal login is not affected.
    expect((await api().post("/v1/customer-access/login").send({ code: ana.code, pin: PIN, businessId: a.business.id })).status).toBe(201);
    await fresh();
    expect((await verify(saleR.verifyCode)).status).toBe(200);
  });

  it("status per spec: voided sale → «anulado»; the reversal verifies as vigente with the original amount; a replaced receipt → «reemplazado»", async () => {
    const s = (await post(a, "/v1/sales", { lines: [{ productId: productA, qty: 2, unitPrice: 1000 }], paymentKind: "credit", customerId: ana.id, amountReceived: 0 })).body;
    const sr = await owner(a, s.receipts[0].id);
    const v = await post(a, `/v1/sales/${s.id}/void`, { reasonCode: "error_digitacion" });
    expect(v.status).toBe(201);
    const an = await verify(sr.verifyCode);
    expect(an.body).toMatchObject({ valid: true, status: "anulado", kind: "sale", amount: "2000" });
    const rr = await owner(a, v.body.receipts[0].id);
    const rv = await verify(rr.verifyCode);
    expect(rv.body).toMatchObject({ valid: true, kind: "reversal", status: "vigente", amount: "2000", number: rr.number });
    expect(Object.keys(rv.body).sort()).toEqual(FIELDS);
    // «reemplazado»: a later receipt points to it via prev_receipt_id (fixture; no PR5 flow emits one yet).
    const p = (await post(a, `/v1/customers/${ana.id}/payments`, { amount: 500, method: "Efectivo" })).body;
    const pr = await owner(a, p.receipts[0].id);
    await prisma.receipt.create({
      data: {
        id: randomUUID(), businessId: a.business.id, customerId: ana.id, kind: "payment", sourceType: "customer_payment",
        sourceId: randomUUID(), number: "DC-P-999999", verifyCode: "ZZZZ2345ZZ", snapshot: {}, contentHash: "f".repeat(64), prevReceiptId: pr.id,
      },
    });
    const rp = await verify(pr.verifyCode);
    expect(rp.body).toMatchObject({ valid: true, status: "reemplazado", kind: "payment", amount: "500" });
  });

  it("isolation: each code answers only its own business name; internal receipts verify with the same minimal shape", async () => {
    const rb = await verify(bR.verifyCode);
    expect(rb.status).toBe(200);
    expect(rb.body).toMatchObject({ businessName: "Tienda Verifica B", number: "DC-000001", amount: "1000" });
    expect(JSON.stringify(rb.body)).not.toContain("Tienda Verifica A");
    // Business A's owner token does not change B's answer, and vice versa.
    expect((await verify(bR.verifyCode).set(admin(a))).body).toEqual(rb.body);
    expect((await verify(saleR.verifyCode).set(admin(b))).body.businessName).toBe("Tienda Verifica A");
    const ri = await verify(internalR.verifyCode);
    expect(ri.status).toBe(200);
    expect(Object.keys(ri.body).sort()).toEqual(FIELDS);
    expect(ri.body).toMatchObject({ kind: "sale", amount: "1000", businessName: "Tienda Verifica A" });
  });
});
