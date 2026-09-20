import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import * as bcrypt from "bcrypt";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { installBigIntJson } from "../src/shared/bigint";
import { occurredOnKey } from "../src/shared/clock";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

describe("Fase 6 backend", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;

  let tokenA = "";
  let tokenB = "";
  let bizA = "";
  let bizB = "";

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
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());

  it("health without auth", async () => {
    const res = await api().get("/v1/health").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.db).toBe("up");
  });

  it("register + login + me", async () => {
    const email = "a@test.co";
    const reg = await seedOwner(app, email, "Puesto A");
    expect(reg.accessToken).toBeTruthy();
    expect(reg.user.email).toBe(email);
    bizA = reg.business.id;
    tokenA = reg.accessToken;

    await api()
      .post("/v1/auth/login")
      .send({ email, password: "wrong-password" })
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("UNAUTHORIZED"));

    const login = await api()
      .post("/v1/auth/login")
      .send({ email, password: "password12" })
      .expect(201);
    tokenA = login.body.accessToken;

    const me = await api()
      .get("/v1/me")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);
    expect(me.body.memberships[0].role).toBe("owner");
  });

  it("second business + tenant isolation", async () => {
    const reg = await seedOwner(app, "b@test.co", "Puesto B");
    tokenB = reg.accessToken;
    bizB = reg.business.id;

    await api()
      .get("/v1/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizB)
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("FORBIDDEN"));
  });

  it("products: gifted, NEED_COST, no cash, idempotency", async () => {
    const key = randomUUID();
    const gifted = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", key)
      .send({
        name: "Galleta de chocolate italiano",
        price: 1000,
        stock: 15,
        avgCost: 0,
        gifted: true,
      })
      .expect(201);
    expect(gifted.body.stock).toBe(15);
    expect(gifted.body.avgCost).toBe(0);
    expect(gifted.body).not.toHaveProperty("gifted");

    const again = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", key)
      .send({
        name: "Galleta de chocolate italiano",
        price: 1000,
        stock: 15,
        gifted: true,
      })
      .expect(201);
    expect(again.body.id).toBe(gifted.body.id);

    await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Olvido", price: 500, stock: 10, avgCost: 0, gifted: false })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("NEED_COST"));

    const today = await api()
      .get("/v1/cash/today")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    expect(today.body.moves).toHaveLength(0);
  });

  it("customer debt starts at 0", async () => {
    const c = await api()
      .post("/v1/customers")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .send({ name: "Doña Test" })
      .expect(201);
    expect(c.body.debt).toBe(0);
  });

  it("cross-tenant product 404 / cannot sell B's product", async () => {
    const pB = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Producto B", price: 100, stock: 5, avgCost: 50 })
      .expect(201);

    await api()
      .get(`/v1/products/${pB.body.id}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(404);

    await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: pB.body.id, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 100,
        method: "Efectivo",
      })
      .expect(404);
  });

  let galletaId = "";
  let customerId = "";

  it("scenario: gifted galleta sale + caja + fiado + abono", async () => {
    const list = await api()
      .get("/v1/products")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    galletaId = list.body.find(
      (p: { name: string }) => p.name === "Galleta de chocolate italiano",
    ).id;

    const customers = await api()
      .get("/v1/customers")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    customerId = customers.body[0].id;

    const opened = await api()
      .post("/v1/cash/sessions")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .send({ openingFloat: 5000 })
      .expect(201);
    expect(opened.body.openingFloat).toBe(5000);

    const dupOpen = await api()
      .post("/v1/cash/sessions")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .send({ openingFloat: 9999 })
      .expect(201);
    expect(dupOpen.body.id).toBe(opened.body.id);
    expect(dupOpen.body.openingFloat).toBe(5000);

    const saleKey = randomUUID();
    const sale = await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", saleKey)
      .send({
        lines: [{ productId: galletaId, qty: 3, unitPrice: 1000 }],
        paymentKind: "paid",
        amountReceived: 3000,
        method: "Efectivo",
      })
      .expect(201);
    expect(sale.body.saleTotal).toBe(3000);
    expect(sale.body.credit).toBe(0);
    expect(sale.body.lines[0].unitCost).toBe(0);
    expect(sale.body.lines[0].unitPrice).toBe(1000);

    const again = await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", saleKey)
      .send({
        lines: [{ productId: galletaId, qty: 3, unitPrice: 1000 }],
        paymentKind: "paid",
        amountReceived: 3000,
        method: "Efectivo",
      })
      .expect(201);
    expect(again.body.id).toBe(sale.body.id);

    const product = await api()
      .get(`/v1/products/${galletaId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    expect(product.body.stock).toBe(12);

    const today = await api()
      .get("/v1/cash/today")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    expect(today.body.expected.efectivo).toBe(8000);
    expect(today.body.expected.nequi).toBe(0);
    expect(today.body.moves).toHaveLength(1);
    expect(today.body.moves[0].kind).toBe("sale");

    const credit = await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: galletaId, qty: 2 }],
        paymentKind: "credit",
        amountReceived: 0,
        customerId,
      })
      .expect(201);
    expect(credit.body.credit).toBe(2000);

    const cust = await api()
      .get(`/v1/customers/${customerId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    expect(cust.body.debt).toBe(2000);

    const payKey = randomUUID();
    const pay = await api()
      .post(`/v1/customers/${customerId}/payments`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", payKey)
      .send({ amount: 500, method: "Nequi" })
      .expect(201);
    expect(pay.body.amount).toBe(500);

    await api()
      .post(`/v1/customers/${customerId}/payments`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", payKey)
      .send({ amount: 500, method: "Nequi" })
      .expect(201);

    const afterPay = await api()
      .get(`/v1/customers/${customerId}`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    expect(afterPay.body.debt).toBe(1500);

    await api()
      .post(`/v1/customers/${customerId}/payments`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 99999, method: "Efectivo" })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("ABONO_EXCEEDS_DEBT"));

    const today2 = await api()
      .get("/v1/cash/today")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    expect(today2.body.expected.efectivo).toBe(8000);
    expect(today2.body.expected.nequi).toBe(500);

    const closed = await api()
      .post(`/v1/cash/sessions/${opened.body.id}/close`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .send({ countedEfectivo: 8000 })
      .expect(201);
    expect(closed.body.expectedEfectivo).toBe(8000);
    expect(closed.body.expectedNequi).toBe(500);
    expect(closed.body.difference).toBe(0);

    await api()
      .post(`/v1/cash/sessions/${opened.body.id}/close`)
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .send({ countedEfectivo: 1 })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("SESSION_ALREADY_CLOSED"));

    await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: galletaId, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 1000,
        method: "Efectivo",
      })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("CLOSED_DAY"));
  });

  it("paid Nequi, partial, custom price, rollback, insufficient stock", async () => {
    const p = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Chicle", price: 200, stock: 4, avgCost: 50 })
      .expect(201);
    const pid = p.body.id;
    const cust = await api()
      .post("/v1/customers")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .send({ name: "Carlos" })
      .expect(201);

    const nequi = await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: pid, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 200,
        method: "Nequi",
      })
      .expect(201);
    expect(nequi.body.method).toBe("Nequi");
    expect(nequi.body.lines[0].unitCost).toBe(50);

    const partial = await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: pid, qty: 1, unitPrice: 250 }],
        paymentKind: "partial",
        amountReceived: 100,
        method: "Efectivo",
        customerId: cust.body.id,
      })
      .expect(201);
    expect(partial.body.saleTotal).toBe(250);
    expect(partial.body.credit).toBe(150);
    expect(partial.body.lines[0].unitPrice).toBe(250);

    const after = await api()
      .get(`/v1/products/${pid}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .expect(200);
    expect(after.body.stock).toBe(2);

    const p2 = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Sin stock", price: 100, stock: 0, avgCost: 0 })
      .expect(201);

    await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [
          { productId: pid, qty: 1 },
          { productId: p2.body.id, qty: 1 },
        ],
        paymentKind: "paid",
        amountReceived: 300,
        method: "Efectivo",
      })
      .expect(409);

    const still = await api()
      .get(`/v1/products/${pid}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .expect(200);
    expect(still.body.stock).toBe(2);

    await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: pid, qty: 99 }],
        paymentKind: "paid",
        amountReceived: 19800,
        method: "Efectivo",
      })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("INSUFFICIENT_STOCK"));
  });

  it("concurrent stock cannot go negative", async () => {
    const p = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Ultima unidad", price: 100, stock: 1, avgCost: 10 })
      .expect(201);

    const results = await Promise.allSettled([
      api()
        .post("/v1/sales")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Business-Id", bizB)
        .set("Idempotency-Key", randomUUID())
        .send({
          lines: [{ productId: p.body.id, qty: 1 }],
          paymentKind: "paid",
          amountReceived: 100,
          method: "Efectivo",
        }),
      api()
        .post("/v1/sales")
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Business-Id", bizB)
        .set("Idempotency-Key", randomUUID())
        .send({
          lines: [{ productId: p.body.id, qty: 1 }],
          paymentKind: "paid",
          amountReceived: 100,
          method: "Efectivo",
        }),
    ]);
    const statuses = results.map((r) =>
      r.status === "fulfilled" ? r.value.status : 0,
    );
    expect(statuses.sort()).toEqual([201, 409]);
    const left = await api()
      .get(`/v1/products/${p.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .expect(200);
    expect(left.body.stock).toBe(0);
  });

  it("commercial day uses America/Bogota, not server TZ", () => {
    expect(
      occurredOnKey("America/Bogota", new Date("2026-09-18T04:30:00.000Z")),
    ).toBe("2026-09-17");
    expect(
      occurredOnKey("America/Bogota", new Date("2026-09-18T05:00:00.000Z")),
    ).toBe("2026-09-18");
  });

  it("logout, invalid token, missing token", async () => {
    await api()
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(201)
      .expect((r) => expect(r.body.ok).toBe(true));

    await api().get("/v1/me").expect(401);
    await api()
      .get("/v1/me")
      .set("Authorization", "Bearer not-a-jwt")
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("UNAUTHORIZED"));
  });

  it("PATCH stock/debt rejected; snapshots survive catalog change", async () => {
    const p = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        name: "Snapshot cola",
        price: 1500,
        stock: 8,
        avgCost: 400,
      })
      .expect(201);

    const sale = await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: p.body.id, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 1500,
        method: "Efectivo",
      })
      .expect(201);
    expect(sale.body.lines[0].unitPrice).toBe(1500);
    expect(sale.body.lines[0].unitCost).toBe(400);

    await api()
      .patch(`/v1/products/${p.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .send({ stock: 99 })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("STOCK_VIA_MOVES"));

    await api()
      .patch(`/v1/products/${p.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .send({ price: 2000 })
      .expect(200);

    const again = await api()
      .get(`/v1/sales/${sale.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .expect(200);
    expect(again.body.lines[0].unitPrice).toBe(1500);
    expect(again.body.lines[0].unitCost).toBe(400);
    expect(again.body.saleTotal).toBe(1500);

    const cust = await api()
      .post("/v1/customers")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .send({ name: "No patch debt" })
      .expect(201);
    await api()
      .patch(`/v1/customers/${cust.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .send({ debt: 1 })
      .expect(400);
  });

  it("staff can sell, cannot archive; concurrent abonos cannot overpay", async () => {
    const prisma = app.get(PrismaService);
    const staffEmail = "staff-a@test.co";
    const staffId = randomUUID();
    await prisma.user.create({
      data: {
        id: staffId,
        email: staffEmail,
        passwordHash: await bcrypt.hash("password12", 12),
      },
    });
    await prisma.businessMembership.create({
      data: {
        id: randomUUID(),
        businessId: bizA,
        userId: staffId,
        role: "staff",
      },
    });
    const login = await api()
      .post("/v1/auth/login")
      .send({ email: staffEmail, password: "password12" })
      .expect(201);
    const staffToken = login.body.accessToken;

    const products = await api()
      .get("/v1/products")
      .set("Authorization", `Bearer ${staffToken}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    expect(products.body.length).toBeGreaterThan(0);

    await api()
      .post(`/v1/products/${products.body[0].id}/archive`)
      .set("Authorization", `Bearer ${staffToken}`)
      .set("X-Business-Id", bizA)
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("FORBIDDEN"));

    const p = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Deuda race", price: 1000, stock: 5, avgCost: 200 })
      .expect(201);
    const cust = await api()
      .post("/v1/customers")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .send({ name: "Fiado race" })
      .expect(201);
    await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: p.body.id, qty: 1 }],
        paymentKind: "credit",
        amountReceived: 0,
        customerId: cust.body.id,
      })
      .expect(201);

    const results = await Promise.allSettled([
      api()
        .post(`/v1/customers/${cust.body.id}/payments`)
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Business-Id", bizB)
        .set("Idempotency-Key", randomUUID())
        .send({ amount: 1000, method: "Efectivo" }),
      api()
        .post(`/v1/customers/${cust.body.id}/payments`)
        .set("Authorization", `Bearer ${tokenB}`)
        .set("X-Business-Id", bizB)
        .set("Idempotency-Key", randomUUID())
        .send({ amount: 1000, method: "Nequi" }),
    ]);
    const statuses = results.map((r) =>
      r.status === "fulfilled" ? r.value.status : 0,
    );
    expect(statuses.sort()).toEqual([201, 409]);
    const left = await api()
      .get(`/v1/customers/${cust.body.id}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .expect(200);
    expect(left.body.debt).toBe(0);
  });

  it("second open after close returns the existing session", async () => {
    const today = await api()
      .get("/v1/cash/today")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .expect(200);
    expect(today.body.closed).toBe(true);
    const again = await api()
      .post("/v1/cash/sessions")
      .set("Authorization", `Bearer ${tokenA}`)
      .set("X-Business-Id", bizA)
      .send({ openingFloat: 1 })
      .expect(201);
    expect(again.body.id).toBe(today.body.session.id);
    expect(again.body.closedAt).toBeTruthy();
  });

  it("mismatching body requestId is VALIDATION", async () => {
    await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        name: "Bad key",
        price: 100,
        stock: 0,
        requestId: randomUUID(),
      })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("VALIDATION"));
  });

  it("COP JSON stays integer for large candy-cart amounts", async () => {
    const p = await api()
      .post("/v1/products")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        name: "Caja grande",
        price: 1000000,
        stock: 2,
        avgCost: 45000,
      })
      .expect(201);
    expect(p.body.price).toBe(1000000);
    expect(p.body.avgCost).toBe(45000);
    const sale = await api()
      .post("/v1/sales")
      .set("Authorization", `Bearer ${tokenB}`)
      .set("X-Business-Id", bizB)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: p.body.id, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 1000000,
        method: "Efectivo",
      })
      .expect(201);
    expect(sale.body.saleTotal).toBe(1000000);
    expect(typeof sale.body.saleTotal).toBe("number");
  });
});
