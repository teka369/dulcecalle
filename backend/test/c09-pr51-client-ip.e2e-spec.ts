import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureHttp } from "../src/http-setup";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();
jest.setTimeout(60000);

/**
 * C09-PR5.1 (C09-INV-02) — throttles count the REAL client IP behind
 * Cloudflare → Render, without opening spoofing. The app is configured as in
 * prod (configureHttp: trust proxy 1). Each request mimics what reaches the
 * app there (Cloudflare HTTP headers doc + Render DDoS article):
 *   CF-Connecting-IP: <client>            (set by Cloudflare's edge)
 *   X-Forwarded-For: [<forged>,] <client>, <cloudflare edge IP>
 * The edge IP varies between requests; that is what made req.ip (trust
 * proxy 1 = right-most XFF entry) useless as a per-client key.
 * Documentation IPs only (RFC 5737 + a Cloudflare-like 104.22.x). Fictitious data.
 */
describe("C09-PR5.1 throttle keyed by the real client IP (C09-INV-02)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  const prev = process.env.DISABLE_THROTTLE;
  const PIN = "482915";

  beforeAll(async () => {
    delete process.env.DISABLE_THROTTLE;
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    execSync(`${path.join(__dirname, "..", "node_modules", ".bin", "prisma")} migrate deploy`, {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureHttp(app as NestExpressApplication, { NODE_ENV: "production" });
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
    if (prev === undefined) delete process.env.DISABLE_THROTTLE;
    else process.env.DISABLE_THROTTLE = prev;
  });

  const api = () => request(app.getHttpServer());
  /** What Render hands the app for `client` seen by Cloudflare edge `edge`. */
  const via = (client: string, edge: string, forged?: string) => ({
    "CF-Connecting-IP": client,
    "X-Forwarded-For": [forged, client, edge].filter(Boolean).join(", "),
  });
  let n = 0;
  /** A wrong login on a fresh unknown code, so only the HTTP throttle (10/60 s) can answer 429. */
  const probe = (headers: Record<string, string>) =>
    api().post("/v1/customer-access/login").set(headers).send({ code: `DC-${String(9000 + (n++ % 999)).padStart(4, "0")}`, pin: "000000" });

  it("same real IP, varying Cloudflare edge in XFF → 429 on the 11th login (HTTP 10/60 s)", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await probe(via("203.0.113.7", `104.22.17.${i + 1}`));
      expect(r.status).toBe(401);
    }
    const r = await probe(via("203.0.113.7", "104.22.17.99"));
    expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 429, code: "RATE_LIMIT" });
  });

  it("a client-forged left-most XFF entry does not change the bucket", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await probe(via("203.0.113.8", `104.22.18.${i + 1}`, `198.51.100.${i + 1}`));
      expect(r.status).toBe(401);
    }
    const r = await probe(via("203.0.113.8", "104.22.18.99", "198.51.100.99"));
    expect(r.status).toBe(429);
  });

  it("two clients behind the same Cloudflare edge do not share a bucket", async () => {
    for (let i = 0; i < 10; i++) expect((await probe(via("203.0.113.9", "104.22.19.40"))).status).toBe(401);
    expect((await probe(via("203.0.113.9", "104.22.19.40"))).status).toBe(429);
    const other = await probe(via("203.0.113.10", "104.22.19.40"));
    expect(other.status).toBe(401);
  });

  it("public verify (10/min) is per real client too: A is cut at the 11th, B behind the same edge is not", async () => {
    const code = "ZZZZ-ZZZZ-ZZ".replace(/-/g, "");
    for (let i = 0; i < 10; i++) {
      expect((await api().get(`/v1/receipts/verify/${code}`).set(via("203.0.113.11", `104.22.20.${i + 1}`))).status).toBe(404);
    }
    expect((await api().get(`/v1/receipts/verify/${code}`).set(via("203.0.113.11", "104.22.20.99"))).status).toBe(429);
    expect((await api().get(`/v1/receipts/verify/${code}`).set(via("203.0.113.12", "104.22.20.99"))).status).toBe(404);
  });

  async function customerWithPin(o: { accessToken: string; business: { id: string } }, name: string) {
    const auth = { Authorization: `Bearer ${o.accessToken}`, "X-Business-Id": o.business.id };
    const c = await api().post("/v1/customers").set(auth).set("Idempotency-Key", randomUUID()).send({ name });
    expect(c.status).toBe(201);
    expect((await api().post(`/v1/customers/${c.body.id}/pin`).set(auth).send({ pin: PIN })).status).toBe(201);
    return c.body as { id: string; code: string };
  }

  it("per-code PIN cap holds across IPs: 10 wrong PINs from 10 IPs, then the right PIN from an 11th IP → 429; an unknown code gets the same schedule and body", async () => {
    const o = await seedOwner(app, "c09-51-cap@test.co", "Tienda Tope");
    const ana = await customerWithPin(o, "Ana Tope");
    const unknown = "DC-7777";
    let e = 0; // a different edge each time, so only the per-code cap can answer
    const login = (code: string, pin: string, ip: string) =>
      api().post("/v1/customer-access/login").set(via(ip, `104.22.21.${++e}`)).send({ code, pin, businessId: o.business.id });
    for (let i = 0; i < 10; i++) {
      expect((await login(ana.code, "000000", `198.51.100.${10 + i}`)).status).toBe(401);
      expect((await login(unknown, "000000", `198.51.100.${30 + i}`)).status).toBe(401);
    }
    const real = await login(ana.code, PIN, "198.51.100.60");
    const fake = await login(unknown, PIN, "198.51.100.61");
    expect({ status: real.status, code: real.body?.error?.code }).toEqual({ status: 429, code: "RATE_LIMIT" });
    expect(fake.status).toBe(real.status);
    expect(fake.body).toEqual(real.body); // no oracle on whether the code exists
  });

  it("link-login shares that per-code cap: a valid link + right PIN is 429 while the code is capped", async () => {
    const o = await seedOwner(app, "c09-51-link@test.co", "Tienda Enlace Tope");
    const auth = { Authorization: `Bearer ${o.accessToken}`, "X-Business-Id": o.business.id };
    const post = (url: string, body: object) => api().post(url).set(auth).set("Idempotency-Key", randomUUID()).send(body);
    expect((await post("/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    const product = (await post("/v1/products", { name: "Bombón", price: 1000, stock: 10, avgCost: 400 })).body.id;
    const leo = await customerWithPin(o, "Leo Enlace");
    const sale = await post("/v1/sales", { lines: [{ productId: product, qty: 1, unitPrice: 1000 }], paymentKind: "credit", customerId: leo.id, amountReceived: 0 });
    const link = await post(`/v1/receipts/${sale.body.receipts[0].id}/links`, {});
    expect(link.status).toBe(201);
    const token = String(link.body.url).split("/cliente/comprobante/")[1]!;
    for (let i = 0; i < 10; i++) {
      const r = await api().post("/v1/customer-access/login").set(via(`198.51.100.${100 + i}`, `104.22.22.${i + 1}`)).send({ code: leo.code, pin: "000000", businessId: o.business.id });
      expect(r.status).toBe(401);
    }
    const r = await api().post("/v1/customer-access/link-login").set(via("198.51.100.150", "104.22.22.99")).send({ token, pin: PIN });
    expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 429, code: "RATE_LIMIT" });
  });
});
