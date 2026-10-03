import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
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

jest.setTimeout(180000);

describe("Round 2.1 pressure, scale, and refresh replay", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let jwt: JwtService;
  let prisma: PrismaService;

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.DISABLE_THROTTLE = "1";

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
    await app.listen(0, "127.0.0.1");
    jwt = app.get(JwtService);
    prisma = app.get(PrismaService);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());

  function admin(token: string, businessId: string) {
    return { Authorization: `Bearer ${token}`, "X-Business-Id": businessId };
  }

  it("50 concurrent sales of one unit leave stock at zero and one winner", async () => {
    const owner = await seedOwner(app, "r21-stock@test.co", "Stock");
    const customer = await api()
      .post("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Cola" })
      .expect(201);
    const product = await api()
      .post("/v1/products")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Ultima", price: 1000, stock: 1, avgCost: 100 })
      .expect(201);
    const n = 50;
    const results = await Promise.all(
      Array.from({ length: n }, () =>
        api()
          .post("/v1/sales")
          .set(admin(owner.accessToken, owner.business.id))
          .set("Idempotency-Key", randomUUID())
          .send({
            lines: [{ productId: product.body.id, qty: 1, unitPrice: 1000 }],
            paymentKind: "credit",
            customerId: customer.body.id,
            amountReceived: 0,
          }),
      ),
    );
    const counts = results.reduce<Record<number, number>>((acc, res) => {
      acc[res.status] = (acc[res.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(JSON.stringify({ stockRace: { n, counts } }));
    expect(counts[500] ?? 0).toBe(0);
    expect(counts[201]).toBe(1);
    expect(counts[409]).toBe(n - 1);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } });
    expect(Number(row.stock)).toBe(0);
    expect(await prisma.sale.count({ where: { businessId: owner.business.id } })).toBe(1);
    const debtor = await prisma.customer.findUniqueOrThrow({ where: { id: customer.body.id } });
    expect(Number(debtor.debt)).toBe(1000);
    expect(Number(row.stock)).toBeGreaterThanOrEqual(0);
    expect(Number(debtor.debt)).toBeGreaterThanOrEqual(0);
  });

  it("100 concurrent attempts on the last unit and the same debt stay non-negative", async () => {
    const owner = await seedOwner(app, "r22-100@test.co", "Cien");
    const customer = await api()
      .post("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Cien" })
      .expect(201);
    await prisma.customer.update({
      where: { id: customer.body.id },
      data: { debt: 1000n },
    });
    const product = await api()
      .post("/v1/products")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Cien", price: 100, stock: 1, avgCost: 10 })
      .expect(201);
    const extra = await api()
      .post("/v1/products")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Clave cien", price: 100, stock: 20, avgCost: 10 })
      .expect(201);
    const n = 100;
    const sales = await Promise.all(
      Array.from({ length: n }, () =>
        api()
          .post("/v1/sales")
          .set(admin(owner.accessToken, owner.business.id))
          .set("Idempotency-Key", randomUUID())
          .send({
            lines: [{ productId: product.body.id, qty: 1, unitPrice: 100 }],
            paymentKind: "credit",
            customerId: customer.body.id,
            amountReceived: 0,
          }),
      ),
    );
    const saleCounts = sales.reduce<Record<number, number>>((acc, res) => {
      acc[res.status] = (acc[res.status] ?? 0) + 1;
      return acc;
    }, {});
    await prisma.customer.update({
      where: { id: customer.body.id },
      data: { debt: 1000n },
    });
    const pays = await Promise.all(
      Array.from({ length: n }, () =>
        api()
          .post(`/v1/customers/${customer.body.id}/payments`)
          .set(admin(owner.accessToken, owner.business.id))
          .set("Idempotency-Key", randomUUID())
          .send({ amount: 1000, method: "Efectivo" }),
      ),
    );
    const payCounts = pays.reduce<Record<number, number>>((acc, res) => {
      acc[res.status] = (acc[res.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(payCounts[500] ?? 0).toBe(0);
    expect(payCounts[201]).toBe(1);
    expect(Number((await prisma.customer.findUniqueOrThrow({ where: { id: customer.body.id } })).debt)).toBe(0);
    const key = randomUUID();
    const same = await Promise.all(
      Array.from({ length: n }, () =>
        api()
          .post("/v1/sales")
          .set(admin(owner.accessToken, owner.business.id))
          .set("Idempotency-Key", key)
          .send({
            lines: [{ productId: extra.body.id, qty: 1, unitPrice: 100 }],
            paymentKind: "credit",
            customerId: customer.body.id,
            amountReceived: 0,
          }),
      ),
    );
    console.log(JSON.stringify({ n, saleCounts, payCounts, sameStatuses: [...new Set(same.map((res) => res.status))] }));
    expect(saleCounts[500] ?? 0).toBe(0);
    expect(saleCounts[201]).toBe(1);
    expect(same.some((res) => res.status === 500)).toBe(false);
    const stock = await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } });
    expect(Number(stock.stock)).toBe(0);
    const keyed = await prisma.product.findUniqueOrThrow({ where: { id: extra.body.id } });
    expect(Number(keyed.stock)).toBe(19);
    expect(await prisma.sale.count({ where: { businessId: owner.business.id, requestId: key } })).toBe(1);
    expect(await prisma.customerPayment.count({ where: { customerId: customer.body.id } })).toBe(1);
  });

  it("50 concurrent abonos cannot drive debt below zero", async () => {
    const owner = await seedOwner(app, "r21-debt@test.co", "Deuda");
    const customer = await api()
      .post("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Debe" })
      .expect(201);
    await prisma.customer.update({
      where: { id: customer.body.id },
      data: { debt: 1000n },
    });
    const n = 50;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        api()
          .post(`/v1/customers/${customer.body.id}/payments`)
          .set(admin(owner.accessToken, owner.business.id))
          .set("Idempotency-Key", randomUUID())
          .send({ amount: 1000, method: i % 2 === 0 ? "Efectivo" : "Nequi" }),
      ),
    );
    const counts = results.reduce<Record<number, number>>((acc, res) => {
      acc[res.status] = (acc[res.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(JSON.stringify({ debtRace: { n, counts } }));
    expect(counts[500] ?? 0).toBe(0);
    expect(counts[201]).toBe(1);
    expect(counts[409]).toBe(n - 1);
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: customer.body.id } });
    expect(Number(row.debt)).toBe(0);
    expect(
      await prisma.customerPayment.count({ where: { businessId: owner.business.id } }),
    ).toBe(1);
  });

  it("25 parallel posts with one requestId create one sale", async () => {
    const owner = await seedOwner(app, "r21-same@test.co", "Misma");
    const customer = await api()
      .post("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Una" })
      .expect(201);
    const product = await api()
      .post("/v1/products")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Clave", price: 500, stock: 30, avgCost: 10 })
      .expect(201);
    const key = randomUUID();
    const n = 25;
    const results = await Promise.all(
      Array.from({ length: n }, () =>
        api()
          .post("/v1/sales")
          .set(admin(owner.accessToken, owner.business.id))
          .set("Idempotency-Key", key)
          .send({
            lines: [{ productId: product.body.id, qty: 1, unitPrice: 500 }],
            paymentKind: "credit",
            customerId: customer.body.id,
            amountReceived: 0,
          }),
      ),
    );
    const counts = results.reduce<Record<number, number>>((acc, res) => {
      acc[res.status] = (acc[res.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(JSON.stringify({ sameKey: { n, counts } }));
    expect(counts[500] ?? 0).toBe(0);
    expect(await prisma.sale.count({ where: { businessId: owner.business.id } })).toBe(1);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: product.body.id } });
    expect(Number(row.stock)).toBe(29);
  });

  it("load on business A does not change business B", async () => {
    const a = await seedOwner(app, "r21-iso-a@test.co", "Iso A");
    const b = await seedOwner(app, "r21-iso-b@test.co", "Iso B");
    const customerA = await api()
      .post("/v1/customers")
      .set(admin(a.accessToken, a.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Solo A" })
      .expect(201);
    const productA = await api()
      .post("/v1/products")
      .set(admin(a.accessToken, a.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Solo A", price: 100, stock: 20, avgCost: 10 })
      .expect(201);
    const customerB = await api()
      .post("/v1/customers")
      .set(admin(b.accessToken, b.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Solo B" })
      .expect(201);
    await prisma.customer.update({ where: { id: customerB.body.id }, data: { debt: 7000n } });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        api()
          .post("/v1/sales")
          .set(admin(a.accessToken, a.business.id))
          .set("Idempotency-Key", randomUUID())
          .send({
            lines: [{ productId: productA.body.id, qty: 1, unitPrice: 100 }],
            paymentKind: "credit",
            customerId: customerA.body.id,
            amountReceived: 0,
          }),
      ),
    );
    const bRow = await prisma.customer.findUniqueOrThrow({ where: { id: customerB.body.id } });
    expect(Number(bRow.debt)).toBe(7000);
    expect(await prisma.sale.count({ where: { businessId: b.business.id } })).toBe(0);
    expect(await prisma.sale.count({ where: { businessId: a.business.id } })).toBe(20);
  });

  it("lists 10000 and 100000 customers and records the plan", async () => {
    const owner = await seedOwner(app, "r21-scale@test.co", "Escala");
    const chunk = 5000;
    const total = 100_000;
    for (let offset = 0; offset < total; offset += chunk) {
      const rows = Array.from({ length: chunk }, (_, i) => {
        const n = offset + i + 1;
        return {
          id: randomUUID(),
          businessId: owner.business.id,
          code: `DC-${String(n).padStart(6, "0")}`,
          name: `C ${String(n).padStart(6, "0")}`,
          debt: 0n,
        };
      });
      await prisma.customer.createMany({ data: rows });
    }
    const started = Date.now();
    const listed = await api()
      .get("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .expect(200);
    const listMs = Date.now() - started;
    const bytes = JSON.stringify(listed.body).length;
    const plan = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN ANALYZE SELECT id FROM customers WHERE business_id = '${owner.business.id}'::uuid AND archived_at IS NULL ORDER BY name ASC`,
    );
    const heap = process.memoryUsage().heapUsed;
    console.log(
      JSON.stringify({
        customers: listed.body.length,
        listMs,
        bytes,
        heap,
        plan: plan.map((row) => row["QUERY PLAN"]),
      }),
    );
    expect(listed.body.length).toBe(total);
    expect(listMs).toBeLessThan(60_000);
  });

  it("refresh can be replayed, raced, and is not revoked by logout", async () => {
    const owner = await seedOwner(app, "r21-refresh@test.co", "Refresh");
    const first = await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(201);
    const second = await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(201);
    expect(first.body.accessToken).toEqual(expect.any(String));
    expect(second.body.accessToken).toEqual(expect.any(String));

    const raced = await Promise.all(
      Array.from({ length: 10 }, () =>
        api().post("/v1/auth/refresh").send({ refreshToken: owner.refreshToken }),
      ),
    );
    expect(raced.every((res) => res.status === 201)).toBe(true);

    await api()
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .expect(201);
    const afterLogout = await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(201);
    await api()
      .get("/v1/me")
      .set("Authorization", `Bearer ${afterLogout.body.accessToken}`)
      .expect(200);

    const again = await api().post("/v1/auth/login").send({
      email: "r21-refresh@test.co",
      password: "password12",
    });
    expect(again.status).toBe(201);
    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: again.body.refreshToken })
      .expect(201);
    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: owner.refreshToken })
      .expect(201);

    const expired = jwt.sign(
      { sub: owner.user.id, email: owner.user.email, typ: "refresh" },
      { secret: "test-refresh-secret", expiresIn: -10 },
    );
    await api().post("/v1/auth/refresh").send({ refreshToken: expired }).expect(401);
    await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: `${owner.refreshToken}x` })
      .expect(401);

    const other = await seedOwner(app, "r21-other@test.co", "Otro");
    await api()
      .get("/v1/customers")
      .set(admin(afterLogout.body.accessToken, other.business.id))
      .expect(403);

    await prisma.businessMembership.deleteMany({
      where: { userId: owner.user.id, businessId: owner.business.id },
    });
    await api()
      .get("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .expect(403);

    const expiredAccess = jwt.sign(
      { sub: owner.user.id, email: owner.user.email },
      { expiresIn: -10 },
    );
    await api().get("/v1/me").set("Authorization", `Bearer ${expiredAccess}`).expect(401);
  });

  it("lists 100000 products and a 5000-sale ledger", async () => {
    const owner = await seedOwner(app, "r22-products@test.co", "Productos");
    const total = 100_000;
    for (let offset = 0; offset < total; offset += 5000) {
      await prisma.product.createMany({
        data: Array.from({ length: 5000 }, (_, i) => {
          const n = offset + i + 1;
          return {
            id: randomUUID(),
            businessId: owner.business.id,
            name: `P ${String(n).padStart(6, "0")}`,
            price: 1000n,
            avgCost: 100n,
            stock: 1,
            lowStockAt: 0,
          };
        }),
      });
    }
    const started = Date.now();
    const listed = await api()
      .get("/v1/products")
      .set(admin(owner.accessToken, owner.business.id))
      .expect(200);
    const listMs = Date.now() - started;
    const plan = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN ANALYZE SELECT id FROM products WHERE business_id = '${owner.business.id}'::uuid AND archived_at IS NULL ORDER BY name ASC`,
    );
    console.log(
      JSON.stringify({
        products: listed.body.length,
        listMs,
        bytes: JSON.stringify(listed.body).length,
        heap: process.memoryUsage().heapUsed,
        plan: plan.map((row) => row["QUERY PLAN"]),
      }),
    );
    expect(listed.body).toHaveLength(total);
    expect(listMs).toBeLessThan(60_000);

    const customer = await api()
      .post("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Ledger" })
      .expect(201);
    const sales = 5_000;
    await prisma.sale.createMany({
      data: Array.from({ length: sales }, () => ({
        id: randomUUID(),
        businessId: owner.business.id,
        customerId: customer.body.id,
        paymentKind: "credit" as const,
        saleTotal: 1000n,
        amountReceived: 0n,
        credit: 1000n,
        occurredOn: new Date("2026-10-03"),
      })),
    });
    const ledgerStarted = Date.now();
    const ledger = await api()
      .get(`/v1/customers/${customer.body.id}/ledger`)
      .set(admin(owner.accessToken, owner.business.id))
      .expect(200);
    const ledgerMs = Date.now() - ledgerStarted;
    const ledgerPlan = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN ANALYZE SELECT id FROM sales WHERE business_id = '${owner.business.id}'::uuid AND customer_id = '${customer.body.id}'::uuid ORDER BY created_at ASC`,
    );
    console.log(
      JSON.stringify({
        ledgerSales: ledger.body.sales.length,
        ledgerMs,
        ledgerBytes: JSON.stringify(ledger.body).length,
        ledgerPlan: ledgerPlan.map((row) => row["QUERY PLAN"]),
      }),
    );
    expect(ledger.body.sales).toHaveLength(sales);
  });
});
