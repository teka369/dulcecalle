import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

describe("C02 idempotency key bound to the payload (DC-13)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  let token = "";
  let biz = "";

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";

    execSync("npx prisma migrate deploy", {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const owner = await seedOwner(app, "c02@test.co", "C02");
    token = owner.accessToken;
    biz = owner.business.id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());

  function auth() {
    return {
      Authorization: `Bearer ${token}`,
      "X-Business-Id": biz,
    };
  }

  const post = (url: string, body: object, key: string = randomUUID()) =>
    api().post(url).set(auth()).set("Idempotency-Key", key).send(body);

  let productId = "";
  let ana = "";

  it("setup: product, customer with debt, caja open", async () => {
    productId = (await post("/v1/products", { name: "Bombón", price: 1000, stock: 50, avgCost: 400 })).body.id;
    ana = (await post("/v1/customers", { name: "Ana" })).body.id;
    expect((await post(`/v1/customers/${ana}/initial-debts`, { amount: 50_000 })).status).toBe(201);
    expect((await post("/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
  });

  it("abono: same key + same payload replays the original (double tap)", async () => {
    const key = randomUUID();
    const a = await post(`/v1/customers/${ana}/payments`, { amount: 5000, method: "Efectivo" }, key);
    const b = await post(`/v1/customers/${ana}/payments`, { amount: 5000, method: "Efectivo", occurredAt: new Date().toISOString() }, key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.customerPayment.count({ where: { businessId: biz, requestId: key } })).toBe(1);
  });

  it("abono: same key + different amount is 422 IDEMPOTENCY_MISMATCH and never returns the old abono", async () => {
    const key = randomUUID();
    const a = await post(`/v1/customers/${ana}/payments`, { amount: 3000, method: "Efectivo" }, key);
    expect(a.status).toBe(201);
    const b = await post(`/v1/customers/${ana}/payments`, { amount: 7000, method: "Efectivo" }, key);
    expect(b.status).toBe(422);
    expect(b.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    expect(b.body.id).toBeUndefined();
    const c = await post(`/v1/customers/${ana}/payments`, { amount: 3000, method: "Nequi" }, key);
    expect(c.status).toBe(422);
  });

  it("abono: same key on another customer is 422", async () => {
    const beto = (await post("/v1/customers", { name: "Beto" })).body.id;
    await post(`/v1/customers/${beto}/initial-debts`, { amount: 10_000 });
    const key = randomUUID();
    expect((await post(`/v1/customers/${ana}/payments`, { amount: 1000, method: "Efectivo" }, key)).status).toBe(201);
    expect((await post(`/v1/customers/${beto}/payments`, { amount: 1000, method: "Efectivo" }, key)).status).toBe(422);
  });

  it("sale: same key + same payload replays; different payload is 422", async () => {
    const key = randomUUID();
    const body = { lines: [{ productId, qty: 2 }], paymentKind: "paid", amountReceived: 2000, method: "Efectivo" };
    const a = await post("/v1/sales", body, key);
    expect(a.status).toBe(201);
    const b = await post("/v1/sales", body, key);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    const c = await post("/v1/sales", { ...body, lines: [{ productId, qty: 3 }], amountReceived: 3000 }, key);
    expect(c.status).toBe(422);
    expect(c.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    const d = await post("/v1/sales", { ...body, method: "Nequi" }, key);
    expect(d.status).toBe(422);
    expect(await prisma.sale.count({ where: { businessId: biz, requestId: key } })).toBe(1);
  });
  it("422 carries the Spanish message; client-event replay (C01.1) still idempotent", async () => {
    const key = randomUUID();
    await post(`/v1/customers/${ana}/payments`, { amount: 1200, method: "Efectivo" }, key);
    const b = await post(`/v1/customers/${ana}/payments`, { amount: 1300, method: "Efectivo" }, key);
    expect(b.status).toBe(422);
    expect(b.body.error.message).toBe("Esta operación ya se registró con otros datos. Revisa e inténtalo como una operación nueva.");
    const opId = randomUUID();
    const ev = { operationId: opId, entity: "customerPayment", operation: "create", kind: "rejected", amount: 1300 };
    const k2 = randomUUID();
    const e1 = await post("/v1/audit/client-events", ev, k2);
    const e2 = await post("/v1/audit/client-events", ev, k2);
    expect(e1.status).toBe(201);
    expect(e2.status).toBe(201);
    expect(e2.body.id).toBe(e1.body.id);
  });

  describe("C02.1 legacy NULL payloadHash", () => {
    it("rejects a sale replay when payloadHash is NULL and qty differs", async () => {
      const key = randomUUID();
      const body = {
        lines: [{ productId, qty: 2 }],
        paymentKind: "paid",
        amountReceived: 2000,
        method: "Efectivo",
      };
      const created = await post("/v1/sales", body, key);
      expect(created.status).toBe(201);
      await prisma.sale.update({
        where: { id: created.body.id },
        data: { payloadHash: null },
      });

      const mismatch = await post(
        "/v1/sales",
        { ...body, lines: [{ productId, qty: 3 }] },
        key,
      );
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
      expect(mismatch.body.id).toBeUndefined();
      const row = await prisma.sale.findUnique({ where: { id: created.body.id } });
      expect(row?.payloadHash).toBeNull();
    });

    it("rejects a payment replay when payloadHash is NULL and note differs", async () => {
      const key = randomUUID();
      const body = { amount: 1500, method: "Efectivo", note: "primera" };
      const created = await post(`/v1/customers/${ana}/payments`, body, key);
      expect(created.status).toBe(201);
      await prisma.customerPayment.update({
        where: { id: created.body.id },
        data: { payloadHash: null },
      });

      const mismatch = await post(
        `/v1/customers/${ana}/payments`,
        { ...body, note: "otra" },
        key,
      );
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
      expect(mismatch.body.id).toBeUndefined();
      const row = await prisma.customerPayment.findUnique({
        where: { id: created.body.id },
      });
      expect(row?.payloadHash).toBeNull();
    });

    it("backfills payloadHash on an identical replay when it was NULL", async () => {
      const saleKey = randomUUID();
      const saleBody = {
        lines: [{ productId, qty: 2 }],
        paymentKind: "paid",
        amountReceived: 2000,
        method: "Efectivo",
      };
      const sale = await post("/v1/sales", saleBody, saleKey);
      expect(sale.status).toBe(201);
      await prisma.sale.update({
        where: { id: sale.body.id },
        data: { payloadHash: null },
      });
      const saleAgain = await post("/v1/sales", saleBody, saleKey);
      expect(saleAgain.status).toBe(201);
      expect(saleAgain.body.id).toBe(sale.body.id);
      const saleRow = await prisma.sale.findUnique({ where: { id: sale.body.id } });
      expect(saleRow?.payloadHash).toEqual(expect.any(String));
      expect(saleRow?.payloadHash).toHaveLength(64);

      const payKey = randomUUID();
      const payBody = { amount: 1500, method: "Efectivo", note: "primera" };
      const pay = await post(`/v1/customers/${ana}/payments`, payBody, payKey);
      expect(pay.status).toBe(201);
      await prisma.customerPayment.update({
        where: { id: pay.body.id },
        data: { payloadHash: null },
      });
      const payAgain = await post(`/v1/customers/${ana}/payments`, payBody, payKey);
      expect(payAgain.status).toBe(201);
      expect(payAgain.body.id).toBe(pay.body.id);
      const payRow = await prisma.customerPayment.findUnique({
        where: { id: pay.body.id },
      });
      expect(payRow?.payloadHash).toEqual(expect.any(String));
      expect(payRow?.payloadHash).toHaveLength(64);
    });
  });
});
