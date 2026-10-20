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

/**
 * loop/v1 #3 (Investigador): history lists that grow with data are paged:
 * `limit` (default 200, max 500) + `cursor` (last id of the previous page),
 * newest first. No params → same array shape as before.
 */
describe("paged history lists", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let token = "";
  let biz = "";
  let productId = "";

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
    const owner = await seedOwner(app, "paged@test.co", "Paginada");
    token = owner.accessToken;
    biz = owner.business.id;
    const post = (url: string, body: object) =>
      request(app.getHttpServer()).post(url).set("Authorization", `Bearer ${token}`).set("X-Business-Id", biz).set("Idempotency-Key", randomUUID()).send(body);
    await post("/v1/cash/sessions", { openingFloat: 10000 }).expect(201);
    const p = await post("/v1/products", { name: "Gomita", price: 1000, stock: 100, avgCost: 300 }).expect(201);
    productId = p.body.id;
    for (let i = 0; i < 5; i++) {
      await post("/v1/sales", { lines: [{ productId, qty: 1, unitPrice: 1000 }], paymentKind: "paid", amountReceived: 1000, method: "Efectivo" }).expect(201);
      await post("/v1/expenses", { amount: 100 + i, category: "Bolsas", method: "Efectivo" }).expect(201);
      await post(`/v1/products/${productId}/surtir`, { qty: 1, unitCost: 300, totalCost: 300, method: "Efectivo" }).expect(201);
    }
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const get = (url: string) => request(app.getHttpServer()).get(url).set("Authorization", `Bearer ${token}`).set("X-Business-Id", biz);

  for (const [name, url] of [
    ["sales", () => "/v1/sales"],
    ["expenses", () => "/v1/expenses"],
    ["product moves", () => `/v1/products/${productId}/moves`],
  ] as const) {
    it(`${name}: no params = full array; limit+cursor walk it newest-first without gaps; bad params 400`, async () => {
      const all = (await get(url()).expect(200)).body as { id: string }[];
      expect(all.length).toBeGreaterThanOrEqual(5);
      const sep = url().includes("?") ? "&" : "?";
      const walked: string[] = [];
      let cursor = "";
      for (let i = 0; i < 20; i++) {
        const page = (await get(`${url()}${sep}limit=2${cursor ? `&cursor=${cursor}` : ""}`).expect(200)).body as { id: string }[];
        expect(page.length).toBeLessThanOrEqual(2);
        walked.push(...page.map((r) => r.id));
        if (page.length < 2) break;
        cursor = page[page.length - 1].id;
      }
      expect(walked).toEqual(all.map((r) => r.id));
      await get(`${url()}${sep}limit=0`).expect(400);
      await get(`${url()}${sep}limit=x`).expect(400);
      await get(`${url()}${sep}cursor=nope`).expect(400);
      await get(`${url()}${sep}cursor=${randomUUID()}`).expect(400);
    });
  }

  it("limit above the max is clamped (500)", async () => {
    const res = await get("/v1/sales?limit=100000").expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
