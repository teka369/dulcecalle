import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

// One bcrypt per login (every branch) is asserted in portal-login-hardening.unit-spec.ts.

/**
 * loop/v1 #4: a customer code present in 2+ stores, no businessId → the same
 * generic 401 as an unknown code (no enumeration, no store named); with the
 * optional `store` (short name or 8-char code) it logs into that store; wrong
 * store and wrong PIN give the same generic 401.
 */
describe("portal login: multi-store code needs the store", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  const PIN_A = "482913";
  const PIN_B = "739104";
  let bizA = "";
  let bizB = "";
  let code = "";

  beforeAll(async () => {
    if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    else {
      pg = await startLocalPostgres();
      process.env.DATABASE_URL = pg.url;
    }
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    execSync("npx prisma migrate deploy", { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "inherit" });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    const a = await seedOwner(app, "multi-a@test.co", "Dulcería Norte");
    const b = await seedOwner(app, "multi-b@test.co", "Tienda Sur");
    bizA = a.business.id;
    bizB = b.business.id;
    const codes: string[] = [];
    for (const [o, pin] of [[a, PIN_A], [b, PIN_B]] as const) {
      const h = { Authorization: `Bearer ${o.accessToken}`, "X-Business-Id": o.business.id };
      const c = await request(app.getHttpServer()).post("/v1/customers").set(h).set("Idempotency-Key", randomUUID()).send({ name: "Rosa" }).expect(201);
      await request(app.getHttpServer()).post(`/v1/customers/${c.body.id}/pin`).set(h).send({ pin }).expect(201);
      codes.push(c.body.code);
    }
    expect(codes[0]).toBe(codes[1]);
    code = codes[0];
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const login = (body: Record<string, string>) =>
    request(app.getHttpServer()).post("/v1/customer-access/login").send({ code, ...body });

  it("no businessId, no store → the generic 401 (same as an unknown code), names no store", async () => {
    const res = await login({ pin: PIN_A }).expect(401);
    const unknown = await request(app.getHttpServer()).post("/v1/customer-access/login").send({ code: "DC-9999", pin: PIN_A }).expect(401);
    expect(res.body).toEqual(unknown.body);
    const raw = JSON.stringify(res.body);
    for (const leak of ["Norte", "Sur", bizA, bizB]) expect(raw).not.toContain(leak);
  });

  it("store by short name (case/accent-insensitive) or 8-char store code → logs into that store", async () => {
    const byName = await login({ pin: PIN_A, store: "  dulceria norte " }).expect(201);
    expect(byName.body.business.id).toBe(bizA);
    const byCode = await login({ pin: PIN_B, store: bizB.slice(0, 8).toUpperCase() }).expect(201);
    expect(byCode.body.business.id).toBe(bizB);
  });

  it("wrong store and wrong PIN → the same generic 401", async () => {
    const wrongStore = await login({ pin: PIN_A, store: "Otra Tienda" }).expect(401);
    const wrongPin = await login({ pin: "000111", store: "Dulcería Norte" }).expect(401);
    const otherStoresPin = await login({ pin: PIN_A, store: "Tienda Sur" }).expect(401);
    expect(wrongStore.body).toEqual(wrongPin.body);
    expect(otherStoresPin.body).toEqual(wrongPin.body);
    expect(wrongPin.body.error.code).toBe("UNAUTHORIZED");
  });

  it("store link (businessId) skips the store step", async () => {
    const res = await login({ pin: PIN_B, businessId: bizB }).expect(201);
    expect(res.body.business.id).toBe(bizB);
  });
});
