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

/**
 * Real PostgreSQL. Uses the embedded server when E2E_DATABASE_URL is unset,
 * or the external database (CI service container) when it is set.
 * Neither path talks to production.
 */
describe("offline close E2E against PostgreSQL", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  let token = "";
  let otherToken = "";
  let biz = "";
  let otherBiz = "";

  beforeAll(async () => {
    if (process.env.E2E_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    } else {
      pg = await startLocalPostgres();
      process.env.DATABASE_URL = pg.url;
    }
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    execSync("npx prisma migrate deploy", {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    const owner = await seedOwner(app, "offline-close@test.co", "Offline Close");
    const other = await seedOwner(app, "offline-other@test.co", "Otro Negocio");
    token = owner.accessToken;
    biz = owner.business.id;
    otherToken = other.accessToken;
    otherBiz = other.business.id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());
  const auth = (business = biz, access = token) => ({
    Authorization: `Bearer ${access}`,
    "X-Business-Id": business,
  });

  async function customer(name: string, business = biz, access = token) {
    const res = await api()
      .post("/v1/customers")
      .set(auth(business, access))
      .set("Idempotency-Key", randomUUID())
      .send({ name })
      .expect(201);
    return res.body as { id: string; debt: number };
  }

  async function product(price: number, stock: number) {
    const res = await api()
      .post("/v1/products")
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Gomitas", price, stock, avgCost: 400 })
      .expect(201);
    return res.body as { id: string; stock: number };
  }

  it("E2E-1 creates a customer and one initial debt", async () => {
    const person = await customer("Ana");
    const key = randomUUID();
    const debt = await api()
      .post(`/v1/customers/${person.id}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", key)
      .send({ amount: 100_000, note: "saldo anterior" })
      .expect(201);
    expect(debt.body.amount).toBe(100_000);
    const loaded = await api().get(`/v1/customers/${person.id}`).set(auth()).expect(200);
    expect(loaded.body.debt).toBe(100_000);
    expect(await prisma.initialDebt.count({ where: { businessId: biz, customerId: person.id } })).toBe(1);
  });

  it("E2E-2 replays the same Idempotency-Key without a second debt", async () => {
    const person = await customer("Beto");
    const key = randomUUID();
    const first = await api()
      .post(`/v1/customers/${person.id}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", key)
      .send({ amount: 20_000 })
      .expect(201);
    const again = await api()
      .post(`/v1/customers/${person.id}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", key)
      .send({ amount: 20_000 })
      .expect(201);
    expect(again.body.id).toBe(first.body.id);
    const loaded = await api().get(`/v1/customers/${person.id}`).set(auth()).expect(200);
    expect(loaded.body.debt).toBe(20_000);
    expect(await prisma.initialDebt.count({ where: { customerId: person.id } })).toBe(1);
  });

  it("E2E-3 accepts the offline sync sequence once: customer, then debt on the remote id", async () => {
    const customerKey = randomUUID();
    const debtKey = randomUUID();
    const created = await api()
      .post("/v1/customers")
      .set(auth())
      .set("Idempotency-Key", customerKey)
      .send({ name: "Local Ana" })
      .expect(201);
    const remoteId = created.body.id as string;
    const debt = await api()
      .post(`/v1/customers/${remoteId}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", debtKey)
      .send({ amount: 20_000 })
      .expect(201);
    const replayCustomer = await api()
      .post("/v1/customers")
      .set(auth())
      .set("Idempotency-Key", customerKey)
      .send({ name: "Local Ana" })
      .expect(201);
    const replayDebt = await api()
      .post(`/v1/customers/${remoteId}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", debtKey)
      .send({ amount: 20_000 })
      .expect(201);
    expect(replayCustomer.body.id).toBe(remoteId);
    expect(replayDebt.body.id).toBe(debt.body.id);
    const loaded = await api().get(`/v1/customers/${remoteId}`).set(auth()).expect(200);
    expect(loaded.body.debt).toBe(20_000);
    expect(await prisma.customer.count({ where: { businessId: biz, requestId: customerKey } })).toBe(1);
    expect(await prisma.initialDebt.count({ where: { businessId: biz, requestId: debtKey } })).toBe(1);
  });

  it("E2E-4, E2E-5 and the 110000 ledger stay consistent online", async () => {
    const person = await customer("Clara");
    await api()
      .post(`/v1/customers/${person.id}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 100_000 })
      .expect(201);
    const goods = await product(1_000, 100);
    const sale = await api()
      .post("/v1/sales")
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: goods.id, qty: 50 }],
        paymentKind: "credit",
        amountReceived: 0,
        customerId: person.id,
      })
      .expect(201);
    expect(sale.body.credit).toBe(50_000);
    const afterSale = await api().get(`/v1/customers/${person.id}`).set(auth()).expect(200);
    expect(afterSale.body.debt).toBe(150_000);

    const paymentKey = randomUUID();
    await api()
      .post(`/v1/customers/${person.id}/payments`)
      .set(auth())
      .set("Idempotency-Key", paymentKey)
      .send({ amount: 20_000, method: "Efectivo" })
      .expect(201);
    await api()
      .post(`/v1/customers/${person.id}/payments`)
      .set(auth())
      .set("Idempotency-Key", paymentKey)
      .send({ amount: 20_000, method: "Efectivo" })
      .expect(201);
    const afterPay = await api().get(`/v1/customers/${person.id}`).set(auth()).expect(200);
    expect(afterPay.body.debt).toBe(130_000);
    expect(await prisma.customerPayment.count({ where: { customerId: person.id } })).toBe(1);

    const lineId = sale.body.lines[0].id as string;
    const returnKey = randomUUID();
    const returned = await api()
      .post(`/v1/sales/${sale.body.id}/returns`)
      .set(auth())
      .set("Idempotency-Key", returnKey)
      .send({ lines: [{ saleLineId: lineId, qty: 20 }] })
      .expect(201);
    expect(returned.body.debtReduced).toBe(20_000);
    expect(returned.body.refundAmount).toBe(0);
    const again = await api()
      .post(`/v1/sales/${sale.body.id}/returns`)
      .set(auth())
      .set("Idempotency-Key", returnKey)
      .send({ lines: [{ saleLineId: lineId, qty: 20 }] })
      .expect(201);
    expect(again.body.id).toBe(returned.body.id);
    const loaded = await api().get(`/v1/customers/${person.id}`).set(auth()).expect(200);
    expect(loaded.body.debt).toBe(110_000);
    const stored = await api().get(`/v1/products/${goods.id}`).set(auth()).expect(200);
    expect(stored.body.stock).toBe(70);
    expect(await prisma.saleReturn.count({ where: { businessId: biz, requestId: returnKey } })).toBe(1);
  });

  it("E2E-6 and E2E-7 apply return stock once", async () => {
    const person = await customer("Dora");
    const goods = await product(1_000, 10);
    const sale = await api()
      .post("/v1/sales")
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: goods.id, qty: 4 }],
        paymentKind: "paid",
        amountReceived: 4_000,
        method: "Efectivo",
      })
      .expect(201);
    const key = randomUUID();
    const body = { lines: [{ saleLineId: sale.body.lines[0].id as string, qty: 2 }] };
    const first = await api()
      .post(`/v1/sales/${sale.body.id}/returns`)
      .set(auth())
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    expect(first.body.refundAmount).toBe(2_000);
    expect(first.body.debtReduced).toBe(0);
    await api()
      .post(`/v1/sales/${sale.body.id}/returns`)
      .set(auth())
      .set("Idempotency-Key", key)
      .send(body)
      .expect(201);
    const stored = await api().get(`/v1/products/${goods.id}`).set(auth()).expect(200);
    expect(stored.body.stock).toBe(8);
    expect(await prisma.saleReturn.count({ where: { requestId: key } })).toBe(1);
  });

  it("E2E-8 business A cannot read or write business B", async () => {
    const theirs = await customer("Elena", otherBiz, otherToken);
    await api()
      .post(`/v1/customers/${theirs.id}/initial-debts`)
      .set(auth(otherBiz, otherToken))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 70_000 })
      .expect(201);
    await api().get(`/v1/customers/${theirs.id}`).set(auth()).expect(404);
    await api()
      .post(`/v1/customers/${theirs.id}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 1_000 })
      .expect(404);
    const still = await api()
      .get(`/v1/customers/${theirs.id}`)
      .set(auth(otherBiz, otherToken))
      .expect(200);
    expect(still.body.debt).toBe(70_000);
    expect(await prisma.initialDebt.count({ where: { businessId: biz, customerId: theirs.id } })).toBe(0);
    expect(await prisma.initialDebt.count({ where: { businessId: otherBiz, customerId: theirs.id } })).toBe(1);
  });

  it("E2E-9 permanent client errors do not write a debt", async () => {
    const person = await customer("Fabi");
    await api()
      .post(`/v1/customers/${person.id}/initial-debts`)
      .set(auth())
      .send({ amount: 10_000 })
      .expect(400);
    await api()
      .post(`/v1/customers/${randomUUID()}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 10_000 })
      .expect(404);
    await api()
      .post(`/v1/customers/${person.id}/initial-debts`)
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 0 })
      .expect(400);
    const goods = await product(1_000, 2);
    const sale = await api()
      .post("/v1/sales")
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: goods.id, qty: 1 }],
        paymentKind: "credit",
        amountReceived: 0,
        customerId: person.id,
      })
      .expect(201);
    await api()
      .post(`/v1/sales/${sale.body.id}/returns`)
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId: sale.body.lines[0].id, qty: 5 }] })
      .expect(409);
    expect(await prisma.initialDebt.count({ where: { customerId: person.id } })).toBe(0);
    expect(await prisma.saleReturn.count({ where: { saleId: sale.body.id } })).toBe(0);
    const loaded = await api().get(`/v1/customers/${person.id}`).set(auth()).expect(200);
    expect(loaded.body.debt).toBe(1_000);
  });

  it("E2E-10 401 and 403 do not write", async () => {
    const before = await prisma.customer.count({ where: { businessId: biz } });
    await api()
      .post("/v1/customers")
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Sin sesión" })
      .expect(401);
    await api()
      .post("/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Sin negocio" })
      .expect(403);
    await api()
      .post("/v1/customers")
      .set(auth(otherBiz))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Negocio ajeno" })
      .expect(403);
    expect(await prisma.customer.count({ where: { businessId: biz } })).toBe(before);
    expect(await prisma.customer.count({ where: { businessId: otherBiz, name: "Negocio ajeno" } })).toBe(0);
  });
});
