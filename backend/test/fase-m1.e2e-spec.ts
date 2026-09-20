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

describe("Fase M1 domain endpoints", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;

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
    prisma = app.get(PrismaService);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());

  function auth(token: string, biz: string) {
    return {
      Authorization: `Bearer ${token}`,
      "X-Business-Id": biz,
    };
  }

  it("register two tenants", async () => {
    const a = await seedOwner(app, "m1a@test.co", "M1 A");
    tokenA = a.accessToken;
    bizA = a.business.id;

    const b = await seedOwner(app, "m1b@test.co", "M1 B");
    tokenB = b.accessToken;
    bizB = b.business.id;
  });

  it("suppliers: CRUD, tenant isolation, empty name", async () => {
    const created = await api()
      .post("/v1/suppliers")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "  Dulces del Valle  ", phone: "3001112222", notes: "frio" })
      .expect(201);
    expect(created.body.name).toBe("Dulces del Valle");
    expect(created.body.phone).toBe("3001112222");
    expect(created.body.notes).toBe("frio");

    const listed = await api()
      .get("/v1/suppliers")
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe(created.body.id);

    const got = await api()
      .get(`/v1/suppliers/${created.body.id}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(got.body.name).toBe("Dulces del Valle");

    const patched = await api()
      .patch(`/v1/suppliers/${created.body.id}`)
      .set(auth(tokenA, bizA))
      .send({ notes: "mayorista" })
      .expect(200);
    expect(patched.body.notes).toBe("mayorista");
    expect(patched.body.name).toBe("Dulces del Valle");

    await api()
      .post("/v1/suppliers")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "   " })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("VALIDATION"));

    await api()
      .get(`/v1/suppliers/${created.body.id}`)
      .set(auth(tokenB, bizB))
      .expect(404);

    await api()
      .get(`/v1/suppliers/${randomUUID()}`)
      .set(auth(tokenA, bizA))
      .expect(404);

    await api()
      .get("/v1/suppliers")
      .set(auth(tokenA, bizB))
      .expect(403);
  });

  let productId = "";
  let customerId = "";
  let supplierId = "";
  let paidSaleId = "";
  let paidLineId = "";
  let creditSaleId = "";
  let creditLineId = "";
  let partialSaleId = "";
  let partialLineId = "";

  it("seed catalog + open caja", async () => {
    const p = await api()
      .post("/v1/products")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Chocolate", price: 2000, stock: 20, avgCost: 800 })
      .expect(201);
    productId = p.body.id;

    const c = await api()
      .post("/v1/customers")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Doña M1" })
      .expect(201);
    customerId = c.body.id;

    const suppliers = await api()
      .get("/v1/suppliers")
      .set(auth(tokenA, bizA))
      .expect(200);
    supplierId = suppliers.body[0].id;

    const opened = await api()
      .post("/v1/cash/sessions")
      .set(auth(tokenA, bizA))
      .send({ openingFloat: 50_000 })
      .expect(201);
    expect(opened.body.openingFloat).toBe(50_000);
  });

  it("initial debt 45200 is exact, skips day-guard later, is not a sale", async () => {
    const key = randomUUID();
    const row = await api()
      .post(`/v1/customers/${customerId}/initial-debts`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({ amount: 45_200, note: "deuda anterior" })
      .expect(201);
    expect(row.body.amount).toBe(45_200);
    expect(row.body.customerId).toBe(customerId);

    const again = await api()
      .post(`/v1/customers/${customerId}/initial-debts`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({ amount: 45_200, note: "deuda anterior" })
      .expect(201);
    expect(again.body.id).toBe(row.body.id);

    const cust = await api()
      .get(`/v1/customers/${customerId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(cust.body.debt).toBe(45_200);

    const today = await api()
      .get("/v1/cash/today")
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(today.body.moves).toHaveLength(0);

    await api()
      .post(`/v1/customers/${randomUUID()}/initial-debts`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 1000 })
      .expect(404);

    await api()
      .post(`/v1/customers/${customerId}/initial-debts`)
      .set(auth(tokenB, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 1000 })
      .expect(404);

    await api()
      .post(`/v1/customers/${customerId}/initial-debts`)
      .set(auth(tokenA, bizA))
      .send({ amount: 1000 })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("VALIDATION"));

    await api()
      .post(`/v1/customers/${customerId}/initial-debts`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 0 })
      .expect(400);
  });

  it("sales for return cases", async () => {
    const paid = await api()
      .post("/v1/sales")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId, qty: 2 }],
        paymentKind: "paid",
        amountReceived: 4000,
        method: "Efectivo",
      })
      .expect(201);
    paidSaleId = paid.body.id;
    paidLineId = paid.body.lines[0].id;
    expect(paid.body.saleTotal).toBe(4000);

    const credit = await api()
      .post("/v1/sales")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId, qty: 1 }],
        paymentKind: "credit",
        amountReceived: 0,
        customerId,
      })
      .expect(201);
    creditSaleId = credit.body.id;
    creditLineId = credit.body.lines[0].id;
    expect(credit.body.credit).toBe(2000);

    const partial = await api()
      .post("/v1/sales")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId, qty: 1, unitPrice: 2500 }],
        paymentKind: "partial",
        amountReceived: 1000,
        method: "Nequi",
        customerId,
      })
      .expect(201);
    partialSaleId = partial.body.id;
    partialLineId = partial.body.lines[0].id;
    expect(partial.body.credit).toBe(1500);

    const cust = await api()
      .get(`/v1/customers/${customerId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    // 45200 inicial + 2000 credit + 1500 partial
    expect(cust.body.debt).toBe(48_700);

    const product = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(product.body.stock).toBe(16);
  });

  it("return paid sale: stock+, cash out, sale untouched, idempotent", async () => {
    const empty = await api()
      .get(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(empty.body).toEqual([]);

    const key = randomUUID();
    const ret = await api()
      .post(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({ lines: [{ saleLineId: paidLineId, qty: 1 }] })
      .expect(201);
    expect(ret.body.refundAmount).toBe(2000);
    expect(ret.body.debtReduced).toBe(0);
    expect(ret.body.method).toBe("Efectivo");
    expect(ret.body.saleId).toBe(paidSaleId);
    expect(ret.body.lines[0].unitCost).toBe(800);
    expect(ret.body.lines[0].unitPrice).toBe(2000);

    const again = await api()
      .post(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({ lines: [{ saleLineId: paidLineId, qty: 1 }] })
      .expect(201);
    expect(again.body.id).toBe(ret.body.id);

    const listed = await api()
      .get(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(listed.body).toHaveLength(1);

    const sale = await api()
      .get(`/v1/sales/${paidSaleId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(sale.body.saleTotal).toBe(4000);
    expect(sale.body.amountReceived).toBe(4000);

    const product = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(product.body.stock).toBe(17);
    expect(product.body.avgCost).toBe(800);

    await api()
      .post(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId: paidLineId, qty: 2 }] })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("RETURN_EXCEEDS"));

    await api()
      .post(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId: randomUUID(), qty: 1 }] })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("VALIDATION"));

    await api()
      .post(`/v1/sales/${randomUUID()}/returns`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId: paidLineId, qty: 1 }] })
      .expect(404);

    await api()
      .post(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenB, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId: paidLineId, qty: 1 }] })
      .expect(404);

    await api()
      .get(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenB, bizB))
      .expect(404);
  });

  it("return credit: fiada of this sale first, never below debt", async () => {
    const ret = await api()
      .post(`/v1/sales/${creditSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId: creditLineId, qty: 1 }] })
      .expect(201);
    expect(ret.body.debtReduced).toBe(2000);
    expect(ret.body.refundAmount).toBe(0);
    expect(ret.body.method).toBeNull();

    const cust = await api()
      .get(`/v1/customers/${customerId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(cust.body.debt).toBe(46_700);

    const today = await api()
      .get("/v1/cash/today")
      .set(auth(tokenA, bizA))
      .expect(200);
    const refunds = today.body.moves.filter(
      (m: { kind: string }) => m.kind === "devolucion",
    );
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amount).toBe(2000);
  });

  it("return partial: leftover is refund on original sale method", async () => {
    const ret = await api()
      .post(`/v1/sales/${partialSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId: partialLineId, qty: 1 }] })
      .expect(201);
    expect(ret.body.debtReduced).toBe(1500);
    expect(ret.body.refundAmount).toBe(1000);
    expect(ret.body.method).toBe("Nequi");

    const cust = await api()
      .get(`/v1/customers/${customerId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(cust.body.debt).toBe(45_200);
  });

  it("surtir reweights avgCost, total wins, cash compra, idempotent", async () => {
    const before = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    const startStock = before.body.stock as number;
    const startAvg = before.body.avgCost as number;
    expect(startAvg).toBe(800);

    const key = randomUUID();
    const move = await api()
      .post(`/v1/products/${productId}/surtir`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({
        qty: 10,
        unitCost: 1200,
        totalCost: 12_000,
        method: "Efectivo",
        supplierId,
        note: "caja",
      })
      .expect(201);
    expect(move.body.delta).toBe(10);
    expect(move.body.reason).toBe("surtir");
    expect(move.body.unitCost).toBe(1200);
    expect(move.body.supplierId).toBe(supplierId);

    const again = await api()
      .post(`/v1/products/${productId}/surtir`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({
        qty: 10,
        unitCost: 1200,
        totalCost: 12_000,
        method: "Efectivo",
        supplierId,
      })
      .expect(201);
    expect(again.body.id).toBe(move.body.id);

    const after = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(after.body.stock).toBe(startStock + 10);
    const expectedAvg = Math.round(
      (startStock * startAvg + 10 * 1200) / (startStock + 10),
    );
    expect(after.body.avgCost).toBe(expectedAvg);

    const totalWins = await api()
      .post(`/v1/products/${productId}/surtir`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({
        qty: 3,
        unitCost: 100,
        totalCost: 400,
        method: "Nequi",
      })
      .expect(201);
    expect(totalWins.body.unitCost).toBe(133);

    const today = await api()
      .get("/v1/cash/today")
      .set(auth(tokenA, bizA))
      .expect(200);
    const compras = today.body.moves.filter(
      (m: { kind: string }) => m.kind === "compra",
    );
    expect(compras).toHaveLength(2);
    expect(
      compras
        .map((m: { amount: number }) => m.amount)
        .sort((a: number, b: number) => a - b),
    ).toEqual([400, 12_000]);

    const stockOnly = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    const stockBeforeZero = stockOnly.body.stock as number;
    await api()
      .post(`/v1/products/${productId}/surtir`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 2, unitCost: 50, totalCost: 0, method: "Efectivo" })
      .expect(201);
    const afterZero = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(afterZero.body.stock).toBe(stockBeforeZero + 2);
    const comprasAfter = (
      await api().get("/v1/cash/today").set(auth(tokenA, bizA)).expect(200)
    ).body.moves.filter((m: { kind: string }) => m.kind === "compra");
    expect(comprasAfter).toHaveLength(2);

    await api()
      .post(`/v1/products/${productId}/surtir`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({
        qty: 1,
        unitCost: 10,
        totalCost: 10,
        method: "Efectivo",
        supplierId: randomUUID(),
      })
      .expect(404);
    const unchanged = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(unchanged.body.stock).toBe(afterZero.body.stock);

    await api()
      .post(`/v1/products/${randomUUID()}/surtir`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 1, unitCost: 10, totalCost: 10, method: "Efectivo" })
      .expect(404);

    await api()
      .post(`/v1/products/${productId}/surtir`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 0, unitCost: 10, totalCost: 10, method: "Efectivo" })
      .expect(400);
  });

  it("shrink decreases stock without cash; insufficient stock rolls back", async () => {
    const before = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    const start = before.body.stock as number;
    const avg = before.body.avgCost as number;

    const key = randomUUID();
    const move = await api()
      .post(`/v1/products/${productId}/shrink`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({ qty: 2, reason: "me_lo_comi", note: "prueba" })
      .expect(201);
    expect(move.body.delta).toBe(-2);
    expect(move.body.reason).toBe("me_lo_comi");
    expect(move.body.unitCost).toBe(avg);

    const again = await api()
      .post(`/v1/products/${productId}/shrink`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({ qty: 2, reason: "me_lo_comi" })
      .expect(201);
    expect(again.body.id).toBe(move.body.id);

    await api()
      .post(`/v1/products/${productId}/shrink`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 1, reason: "regalar" })
      .expect(201);
    await api()
      .post(`/v1/products/${productId}/shrink`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 1, reason: "perdido" })
      .expect(201);

    const after = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(after.body.stock).toBe(start - 4);
    expect(after.body.avgCost).toBe(avg);

    const today = await api()
      .get("/v1/cash/today")
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(
      today.body.moves.filter((m: { kind: string }) => m.kind === "expense"),
    ).toHaveLength(0);

    await api()
      .post(`/v1/products/${productId}/shrink`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 99_999, reason: "perdido" })
      .expect(409)
      .expect((r) => expect(r.body.error.code).toBe("INSUFFICIENT_STOCK"));
    const still = await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenA, bizA))
      .expect(200);
    expect(still.body.stock).toBe(start - 4);

    await api()
      .post(`/v1/products/${productId}/shrink`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 1, reason: "sale" })
      .expect(400);
  });

  it("expense creates cash_move kind=expense; aporte/retiro are not expenses", async () => {
    const key = randomUUID();
    const exp = await api()
      .post("/v1/expenses")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({
        amount: 3500,
        category: "bolsas",
        method: "Efectivo",
        note: "tienda",
      })
      .expect(201);
    expect(exp.body.amount).toBe(3500);
    expect(exp.body.category).toBe("bolsas");
    expect(exp.body.method).toBe("Efectivo");

    const again = await api()
      .post("/v1/expenses")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", key)
      .send({ amount: 3500, category: "bolsas", method: "Efectivo" })
      .expect(201);
    expect(again.body.id).toBe(exp.body.id);

    const aporteKey = randomUUID();
    const aporte = await api()
      .post("/v1/cash/aportes")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", aporteKey)
      .send({ amount: 10_000, method: "Efectivo", note: "capital" })
      .expect(201);
    expect(aporte.body.kind).toBe("aporte");
    expect(aporte.body.direction).toBe("in");
    expect(aporte.body.amount).toBe(10_000);

    const aporteAgain = await api()
      .post("/v1/cash/aportes")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", aporteKey)
      .send({ amount: 10_000, method: "Efectivo" })
      .expect(201);
    expect(aporteAgain.body.id).toBe(aporte.body.id);

    const retiro = await api()
      .post("/v1/cash/retiros")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 2000, method: "Nequi" })
      .expect(201);
    expect(retiro.body.kind).toBe("retiro");
    expect(retiro.body.direction).toBe("out");
    expect(retiro.body.method).toBe("Nequi");

    const today = await api()
      .get("/v1/cash/today")
      .set(auth(tokenA, bizA))
      .expect(200);
    const expenses = today.body.moves.filter(
      (m: { kind: string }) => m.kind === "expense",
    );
    const aportes = today.body.moves.filter(
      (m: { kind: string }) => m.kind === "aporte",
    );
    const retiros = today.body.moves.filter(
      (m: { kind: string }) => m.kind === "retiro",
    );
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount).toBe(3500);
    expect(aportes).toHaveLength(1);
    expect(retiros).toHaveLength(1);

    const expenseRows = await prisma.expense.findMany({
      where: { businessId: bizA },
    });
    expect(expenseRows).toHaveLength(1);
    const expMoves = await prisma.cashMove.findMany({
      where: { businessId: bizA, kind: "expense" },
    });
    expect(expMoves).toHaveLength(1);
    expect(expMoves[0].refType).toBe("expense");
    expect(expMoves[0].refId).toBe(exp.body.id);
    expect(expMoves[0].requestId).toBeNull();
    expect(Number(expMoves[0].amount)).toBe(3500);

    const aporteOnB = await api()
      .post("/v1/cash/aportes")
      .set(auth(tokenB, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 1500, method: "Efectivo" })
      .expect(201);
    expect(aporteOnB.body.kind).toBe("aporte");
    const bMove = await prisma.cashMove.findUnique({
      where: { id: aporteOnB.body.id },
    });
    expect(bMove?.sessionId).toBeNull();

    await api()
      .post("/v1/expenses")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 100, category: "   ", method: "Efectivo" })
      .expect(400);

    await api()
      .post("/v1/cash/aportes")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 0, method: "Efectivo" })
      .expect(400);

    await api()
      .post("/v1/cash/retiros")
      .set(auth(tokenA, bizA))
      .send({ amount: 100, method: "Efectivo" })
      .expect(400);
  });

  it("closed day blocks economic writes; initial debt stays allowed", async () => {
    const today = await api()
      .get("/v1/cash/today")
      .set(auth(tokenA, bizA))
      .expect(200);
    const sessionId = today.body.session.id as string;

    await api()
      .post(`/v1/cash/sessions/${sessionId}/close`)
      .set(auth(tokenA, bizA))
      .send({ countedEfectivo: today.body.expected.efectivo })
      .expect(201);

    const closed = (body: { error: { code: string } }) =>
      expect(body.error.code).toBe("CLOSED_DAY");

    await api()
      .post(`/v1/sales/${paidSaleId}/returns`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId: paidLineId, qty: 1 }] })
      .expect(409)
      .expect((r) => closed(r.body));

    await api()
      .post(`/v1/products/${productId}/surtir`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 1, unitCost: 10, totalCost: 10, method: "Efectivo" })
      .expect(409)
      .expect((r) => closed(r.body));

    await api()
      .post(`/v1/products/${productId}/shrink`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 1, reason: "perdido" })
      .expect(409)
      .expect((r) => closed(r.body));

    await api()
      .post("/v1/expenses")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 100, category: "otro", method: "Efectivo" })
      .expect(409)
      .expect((r) => closed(r.body));

    await api()
      .post("/v1/cash/aportes")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 100, method: "Efectivo" })
      .expect(409)
      .expect((r) => closed(r.body));

    await api()
      .post("/v1/cash/retiros")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 100, method: "Efectivo" })
      .expect(409)
      .expect((r) => closed(r.body));

    const debtBefore = (
      await api().get(`/v1/customers/${customerId}`).set(auth(tokenA, bizA))
    ).body.debt as number;
    const inicial = await api()
      .post(`/v1/customers/${customerId}/initial-debts`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 500, note: "carga inicial en día cerrado" })
      .expect(201);
    expect(inicial.body.amount).toBe(500);
    const debtAfter = (
      await api().get(`/v1/customers/${customerId}`).set(auth(tokenA, bizA))
    ).body.debt as number;
    expect(debtAfter).toBe(debtBefore + 500);

    const born = await api()
      .post("/v1/products")
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Nacido cerrado", price: 100, stock: 3, avgCost: 40 })
      .expect(201);
    expect(born.body.stock).toBe(3);
  });

  it("cross-tenant product/customer ids are 404, not leaked", async () => {
    await api()
      .get(`/v1/products/${productId}`)
      .set(auth(tokenB, bizB))
      .expect(404);
    await api()
      .patch(`/v1/products/${productId}`)
      .set(auth(tokenB, bizB))
      .send({ name: "Hack" })
      .expect(404);
    await api()
      .get(`/v1/customers/${customerId}`)
      .set(auth(tokenB, bizB))
      .expect(404);
    await api()
      .patch(`/v1/customers/${customerId}`)
      .set(auth(tokenB, bizB))
      .send({ name: "Hack" })
      .expect(404);
    await api()
      .get(`/v1/sales/${paidSaleId}`)
      .set(auth(tokenB, bizB))
      .expect(404);
    await api()
      .patch(`/v1/suppliers/${supplierId}`)
      .set(auth(tokenB, bizB))
      .send({ notes: "Hack" })
      .expect(404);

    await api()
      .post(`/v1/products/${productId}/surtir`)
      .set(auth(tokenB, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 1, unitCost: 20, totalCost: 20, method: "Efectivo" })
      .expect(404);

    await api()
      .post(`/v1/products/${productId}/shrink`)
      .set(auth(tokenB, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({ qty: 1, reason: "perdido" })
      .expect(404);

    const cB = await api()
      .post("/v1/customers")
      .set(auth(tokenB, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Cliente B" })
      .expect(201);
    await api()
      .post(`/v1/customers/${cB.body.id}/initial-debts`)
      .set(auth(tokenA, bizA))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 1000 })
      .expect(404);

    await api()
      .get("/v1/cash/today")
      .set(auth(tokenA, bizB))
      .expect(403);
    await api()
      .post("/v1/expenses")
      .set(auth(tokenA, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 100, category: "aseo", method: "Efectivo" })
      .expect(403)
      .expect((r) => expect(r.body.error.code).toBe("FORBIDDEN"));
    await api()
      .post("/v1/cash/aportes")
      .set(auth(tokenA, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 100, method: "Efectivo" })
      .expect(403);
  });

  it("mismatching requestId is VALIDATION", async () => {
    await api()
      .post("/v1/expenses")
      .set(auth(tokenB, bizB))
      .set("Idempotency-Key", randomUUID())
      .send({
        amount: 100,
        category: "aseo",
        method: "Efectivo",
        requestId: randomUUID(),
      })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("VALIDATION"));
  });
});
