import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { createHmac, randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

const FAIL = "No pudimos identificarte.";

function b64url(value: object | string): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(raw).toString("base64url");
}

describe("Round 2 adversarial portal, tenancy, money", () => {
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

  it("portal login, token substitution, logout, and cross-tenant reads", async () => {
    const a = await seedOwner(app, "r2-a@test.co", "Negocio A");
    const b = await seedOwner(app, "r2-b@test.co", "Negocio B");
    const rosa = await api()
      .post("/v1/customers")
      .set(admin(a.accessToken, a.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Rosa" })
      .expect(201);
    const luisa = await api()
      .post("/v1/customers")
      .set(admin(b.accessToken, b.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Luisa" })
      .expect(201);
    expect(rosa.body.code).toBe("DC-0001");
    expect(luisa.body.code).toBe("DC-0001");

    const product = await api()
      .post("/v1/products")
      .set(admin(a.accessToken, a.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Chicle A", price: 500, stock: 5, avgCost: 100 })
      .expect(201);
    await api()
      .post("/v1/sales")
      .set(admin(a.accessToken, a.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: product.body.id, qty: 1, unitPrice: 500 }],
        paymentKind: "credit",
        customerId: rosa.body.id,
        amountReceived: 0,
      })
      .expect(201);

    const ok = await api()
      .post("/v1/customer-access/login")
      .send({ code: "DC-0001", name: "Rosa" })
      .expect(201);
    expect(ok.body.customer.debt).toBe(500);
    expect(ok.body.business.id).toBe(a.business.id);
    const access = ok.body.accessToken as string;
    const refresh = ok.body.refreshToken as string;
    const [header] = access.split(".");
    const headerJson = JSON.parse(Buffer.from(header, "base64url").toString());
    expect(headerJson.alg).toBe("HS256");
    const claims = jwt.decode(access) as {
      sub: string;
      typ: string;
      businessId: string;
      iss?: string;
      aud?: string;
    };
    expect(claims).toMatchObject({
      sub: rosa.body.id,
      typ: "customer",
      businessId: a.business.id,
    });
    expect(claims.iss).toBeUndefined();
    expect(claims.aud).toBeUndefined();

    const wrongName = await api()
      .post("/v1/customer-access/login")
      .send({ code: "DC-0001", name: "Nadie" })
      .expect(401);
    const wrongCode = await api()
      .post("/v1/customer-access/login")
      .send({ code: "DC-9999", name: "Rosa" })
      .expect(401);
    expect(wrongName.body).toEqual(wrongCode.body);
    expect(wrongCode.body.error.message).toBe(FAIL);

    const asLuisa = await api()
      .post("/v1/customer-access/login")
      .send({ code: "DC-0001", name: "Luisa" })
      .expect(201);
    expect(asLuisa.body.business.id).toBe(b.business.id);
    expect(asLuisa.body.customer.id).toBe(luisa.body.id);

    const bRosa = await api()
      .post("/v1/customers")
      .set(admin(b.accessToken, b.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Rosa" })
      .expect(201);
    expect(bRosa.body.code).not.toBe("DC-0001");
    await prisma.customer.update({
      where: { id: luisa.body.id },
      data: { name: "Rosa" },
    });
    const ambiguous = await api()
      .post("/v1/customer-access/login")
      .send({ code: "DC-0001", name: "Rosa" })
      .expect(401);
    expect(ambiguous.body).toEqual(wrongCode.body);

    const samples = async (code: string, name: string) => {
      const times: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const start = Date.now();
        await api().post("/v1/customer-access/login").send({ code, name }).expect(401);
        times.push(Date.now() - start);
      }
      times.sort((x, y) => x - y);
      return times[2];
    };
    const medianMissing = await samples("DC-9999", "Rosa");
    const medianWrongName = await samples("DC-0001", "Nadie Inventada");
    // Recorded, not asserted as a vulnerability: local medians are noisy.
    console.log(
      JSON.stringify({
        timingMs: { medianMissing, medianWrongName },
      }),
    );

    await api()
      .get("/v1/customer/me/ledger")
      .set("Authorization", `Bearer ${access}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.sales).toHaveLength(1);
        expect(JSON.stringify(res.body)).not.toContain(b.business.id);
      });

    await api()
      .get("/v1/customers")
      .set("Authorization", `Bearer ${access}`)
      .set("X-Business-Id", a.business.id)
      .expect(401);
    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${b.accessToken}`)
      .expect(401);

    const flipped = `${access.slice(0, -1)}${access.endsWith("a") ? "b" : "a"}`;
    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${flipped}`)
      .expect(401);

    const parts = access.split(".");
    const evilPayload = b64url({
      sub: rosa.body.id,
      typ: "customer",
      businessId: b.business.id,
    });
    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${parts[0]}.${evilPayload}.${parts[2]}`)
      .expect(401);

    const none = `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
      sub: rosa.body.id,
      typ: "customer",
      businessId: a.business.id,
    })}.`;
    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${none}`)
      .expect(401);

    const expired = jwt.sign(
      { sub: rosa.body.id, businessId: a.business.id, typ: "customer" },
      { expiresIn: -10 },
    );
    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);

    const forged = createHmac("sha256", "wrong-secret")
      .update(`${parts[0]}.${parts[1]}`)
      .digest("base64url");
    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${parts[0]}.${parts[1]}.${forged}`)
      .expect(401);

    await api()
      .get(`/v1/customers/${luisa.body.id}`)
      .set(admin(a.accessToken, a.business.id))
      .expect(404);
    await api()
      .get("/v1/customers")
      .set(admin(a.accessToken, b.business.id))
      .expect(403);

    await api()
      .post("/v1/auth/logout")
      .set("Authorization", `Bearer ${a.accessToken}`)
      .expect(201);
    const still = await api()
      .post("/v1/auth/refresh")
      .send({ refreshToken: a.refreshToken })
      .expect(201);
    expect(still.body.accessToken).toEqual(expect.any(String));
    await api()
      .get("/v1/me")
      .set("Authorization", `Bearer ${still.body.accessToken}`)
      .expect(200);

    await api()
      .post("/v1/customer-access/logout")
      .set("Authorization", `Bearer ${access}`)
      .expect(201);
    const customerStill = await api()
      .post("/v1/customer-access/refresh")
      .send({ refreshToken: refresh })
      .expect(201);
    expect(customerStill.body.accessToken).toEqual(expect.any(String));

    await prisma.businessMembership.deleteMany({
      where: { userId: a.user.id, businessId: a.business.id },
    });
    await api()
      .get("/v1/customers")
      .set(admin(a.accessToken, a.business.id))
      .expect(403);
  });

  it("same requestId with a different payload keeps the first sale only", async () => {
    const owner = await seedOwner(app, "r2-idem@test.co", "Idem");
    const customer = await api()
      .post("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Nena" })
      .expect(201);
    const product = await api()
      .post("/v1/products")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Goma", price: 1000, stock: 10, avgCost: 100 })
      .expect(201);
    const key = randomUUID();
    const first = await api()
      .post("/v1/sales")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", key)
      .send({
        lines: [{ productId: product.body.id, qty: 1, unitPrice: 1000 }],
        paymentKind: "credit",
        customerId: customer.body.id,
        amountReceived: 0,
      })
      .expect(201);
    const second = await api()
      .post("/v1/sales")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", key)
      .send({
        lines: [{ productId: product.body.id, qty: 9, unitPrice: 1000 }],
        paymentKind: "credit",
        customerId: customer.body.id,
        amountReceived: 0,
      })
      .expect(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.saleTotal).toBe(1000);
    const row = await prisma.product.findUniqueOrThrow({
      where: { id: product.body.id },
    });
    expect(Number(row.stock)).toBe(9);
    expect(
      await prisma.sale.count({ where: { businessId: owner.business.id } }),
    ).toBe(1);
    const debtor = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.body.id },
    });
    expect(Number(debtor.debt)).toBe(1000);
  });

  it("two concurrent sales cannot both take the last unit", async () => {
    const owner = await seedOwner(app, "r2-race@test.co", "Race");
    const customer = await api()
      .post("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Pila" })
      .expect(201);
    const product = await api()
      .post("/v1/products")
      .set(admin(owner.accessToken, owner.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Unica", price: 2000, stock: 1, avgCost: 100 })
      .expect(201);
    const sell = () =>
      api()
        .post("/v1/sales")
        .set(admin(owner.accessToken, owner.business.id))
        .set("Idempotency-Key", randomUUID())
        .send({
          lines: [{ productId: product.body.id, qty: 1, unitPrice: 2000 }],
          paymentKind: "credit",
          customerId: customer.body.id,
          amountReceived: 0,
        });
    const [left, right] = await Promise.all([sell(), sell()]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([201, 409]);
    const row = await prisma.product.findUniqueOrThrow({
      where: { id: product.body.id },
    });
    expect(Number(row.stock)).toBe(0);
    expect(
      await prisma.sale.count({ where: { businessId: owner.business.id } }),
    ).toBe(1);
  });

  it("two concurrent abonos cannot both collect the same debt", async () => {
    const owner = await seedOwner(app, "r2-pay@test.co", "Pagos");
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
    const pay = (method: "Efectivo" | "Nequi") =>
      api()
        .post(`/v1/customers/${customer.body.id}/payments`)
        .set(admin(owner.accessToken, owner.business.id))
        .set("Idempotency-Key", randomUUID())
        .send({ amount: 1000, method });
    const [left, right] = await Promise.all([pay("Efectivo"), pay("Nequi")]);
    const statuses = [left.status, right.status].sort();
    expect(statuses).toEqual([201, 409]);
    const row = await prisma.customer.findUniqueOrThrow({
      where: { id: customer.body.id },
    });
    expect(Number(row.debt)).toBe(0);
    expect(
      await prisma.customerPayment.count({
        where: { businessId: owner.business.id },
      }),
    ).toBe(1);
    expect(Number(row.debt)).toBeGreaterThanOrEqual(0);
  });

  it("lists every customer with no page cap and records the plan", async () => {
    const owner = await seedOwner(app, "r2-list@test.co", "Lista");
    const n = 2000;
    const rows = Array.from({ length: n }, (_, i) => ({
      id: randomUUID(),
      businessId: owner.business.id,
      code: `DC-${String(i + 1).padStart(4, "0")}`,
      name: `Cliente ${String(i).padStart(5, "0")}`,
      debt: 0n,
    }));
    await prisma.customer.createMany({ data: rows });
    const start = Date.now();
    const listed = await api()
      .get("/v1/customers")
      .set(admin(owner.accessToken, owner.business.id))
      .expect(200);
    const ms = Date.now() - start;
    expect(listed.body).toHaveLength(n);
    const bytes = JSON.stringify(listed.body).length;
    const plan = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
      `EXPLAIN ANALYZE SELECT id FROM customers WHERE business_id = '${owner.business.id}'::uuid AND archived_at IS NULL ORDER BY name ASC`,
    );
    console.log(
      JSON.stringify({
        customers: n,
        listMs: ms,
        bytes,
        plan: plan.map((row) => row["QUERY PLAN"]),
      }),
    );
    expect(ms).toBeLessThan(15000);
  });
});
