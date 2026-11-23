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
 * C09-PR5.2 — Tester C09-PR5-T02: a request whose DIRECT peer is public did
 * not cross Render's private proxy, so neither X-Forwarded-For nor
 * CF-Connecting-IP may pick the bucket: the socket IP does. Also kills the
 * two mutants only Tester caught (c3: CF trusted from any peer; c4: per-code
 * counter not reset after a successful login).
 *
 * (Context from C09-PR5.1 (C09-INV-02) — throttles count the REAL client IP behind
 * Cloudflare → Render, without opening spoofing. The app is configured as in
 * prod (configureHttp: trust proxy = trustPrivateProxy, i.e. trusted only
 * when the peer is in a private subnet, not by hop count). Each request
 * mimics what reaches the
 * app there (Cloudflare HTTP headers doc + Render DDoS article):
 *   CF-Connecting-IP: <client>            (set by Cloudflare's edge)
 *   X-Forwarded-For: [<forged>,] <client>, <cloudflare edge IP>
 * The edge IP varies between requests; that is what made req.ip (trust
 * proxy 1 = right-most XFF entry) useless as a per-client key.
 * Documentation IPs only (RFC 5737 + a Cloudflare-like 104.22.x). Fictitious data.)
 */
describe("C09-PR5.2 client IP: public peer and per-code reset (Tester T02, mutants c3/c4)", () => {
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
    // Test-only peer simulation (same idea as Tester's qa-peer.cjs): supertest
    // always connects from loopback; X-Test-Peer replaces the socket address
    // for that one request so a PUBLIC direct peer can be exercised.
    (app as NestExpressApplication).use((req: { headers: Record<string, unknown>; socket: object }, _res: unknown, next: () => void) => {
      const peer = req.headers["x-test-peer"];
      if (typeof peer === "string") Object.defineProperty(req.socket, "remoteAddress", { value: peer, configurable: true });
      next();
    });
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
  let n = 0;
  /** A wrong login on a fresh unknown code, so only the HTTP throttle (10/60 s) can answer 429. */
  const probe = (headers: Record<string, string>) =>
    api().post("/v1/customer-access/login").set(headers).send({ code: `DC-${String(8000 + (n++ % 999)).padStart(4, "0")}`, pin: "000000" });

  it("T02: public direct peer + 11 different forged X-Forwarded-For → 429 on the 11th (socket IP is the key)", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await probe({ "X-Test-Peer": "198.51.100.78", "X-Forwarded-For": `45.160.0.${i + 1}` });
      expect(r.status).toBe(401);
    }
    const r = await probe({ "X-Test-Peer": "198.51.100.78", "X-Forwarded-For": "45.160.0.99" });
    expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 429, code: "RATE_LIMIT" });
  });

  it("mutant c3: public direct peer + 11 different CF-Connecting-IP (and XFF) → 429 on the 11th", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await probe({ "X-Test-Peer": "198.51.100.79", "CF-Connecting-IP": `203.0.113.${i + 1}`, "X-Forwarded-For": `203.0.113.${i + 1}, 104.22.30.${i + 1}` });
      expect(r.status).toBe(401);
    }
    const r = await probe({ "X-Test-Peer": "198.51.100.79", "CF-Connecting-IP": "203.0.113.99", "X-Forwarded-For": "203.0.113.99, 104.22.30.99" });
    expect(r.status).toBe(429);
  });

  it("control: through a private peer the CF header still separates clients (a public peer did not poison it)", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await probe({ "X-Test-Peer": "10.21.157.68", "CF-Connecting-IP": `203.0.113.${120 + i}`, "X-Forwarded-For": `203.0.113.${120 + i}, 104.22.31.1` });
      expect(r.status).toBe(401);
    }
    const r = await probe({ "X-Test-Peer": "10.21.157.68", "CF-Connecting-IP": "203.0.113.130", "X-Forwarded-For": "203.0.113.130, 104.22.31.1" });
    expect(r.status).toBe(401);
  });

  it("C09-BL-14 (mutant m-d): private peer, no CF header, XFF with forged left entries and VARYING private hops → 429 on the 11th (trust proxy by subnet, not by hop count)", async () => {
    // Same shape as Tester check C9-PRIV-NO-CF. With trust proxy by private
    // subnet, req.ip is the first non-private XFF entry from the right (the
    // client, 203.0.113.140), so all 11 share one bucket. With trust proxy by
    // hop count (e.g. 1) req.ip would be the right-most private hop, which
    // changes every request, and the 11th would still be 401.
    const xff = (i: number) => `198.51.100.${i + 140}, 10.0.0.${i + 1}, 203.0.113.140, 172.16.0.${i + 1}`;
    for (let i = 0; i < 10; i++) {
      const r = await probe({ "X-Test-Peer": "10.21.157.200", "X-Forwarded-For": xff(i) });
      expect(r.status).toBe(401);
    }
    const r = await probe({ "X-Test-Peer": "10.21.157.200", "X-Forwarded-For": xff(10) });
    expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 429, code: "RATE_LIMIT" });
  });

  async function customerWithPin(o: { accessToken: string; business: { id: string } }, name: string) {
    const auth = { Authorization: `Bearer ${o.accessToken}`, "X-Business-Id": o.business.id };
    const c = await api().post("/v1/customers").set(auth).set("Idempotency-Key", randomUUID()).send({ name });
    expect(c.status).toBe(201);
    expect((await api().post(`/v1/customers/${c.body.id}/pin`).set(auth).send({ pin: PIN })).status).toBe(201);
    return c.body as { id: string; code: string };
  }

  it("mutant c4: a successful login resets the per-code counter (9 wrong → right → 10 wrong are all 401 → the 11th wrong is 429)", async () => {
    const o = await seedOwner(app, "c09-52-reset@test.co", "Tienda Reinicio");
    const ana = await customerWithPin(o, "Ana Reinicio");
    let k = 0; // a different real IP each time, so only the per-code cap can answer
    const login = (pin: string) =>
      api()
        .post("/v1/customer-access/login")
        .set({ "X-Test-Peer": "10.21.157.68", "CF-Connecting-IP": `198.51.100.${++k}` })
        .send({ code: ana.code, pin, businessId: o.business.id });
    for (let i = 0; i < 9; i++) expect((await login("000000")).status).toBe(401);
    expect((await login(PIN)).status).toBe(201);
    const after: number[] = [];
    for (let i = 0; i < 10; i++) after.push((await login("000000")).status);
    expect(after).toEqual(Array(10).fill(401));
    expect((await login("000000")).status).toBe(429);
  });
});
