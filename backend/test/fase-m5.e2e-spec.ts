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
import {
  formatCustomerCode,
  nextCodeFromExisting,
  normalizeCustomerCode,
  normalizePersonName,
} from "../src/shared/customer-code";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

installBigIntJson();

describe("customer codes", () => {
  it("formats and never reuses a historical number", () => {
    expect(formatCustomerCode(1)).toBe("DC-0001");
    expect(formatCustomerCode(12)).toBe("DC-0012");
    expect(nextCodeFromExisting([])).toBe("DC-0001");
    expect(nextCodeFromExisting(["DC-0001", "DC-0003"])).toBe("DC-0004");
    expect(nextCodeFromExisting(["DC-0002"])).toBe("DC-0003");
  });

  it("normalizes typed codes and names", () => {
    expect(normalizeCustomerCode(" dc-1 ")).toBe("DC-0001");
    expect(normalizeCustomerCode("DC0002")).toBe("DC-0002");
    expect(normalizeCustomerCode("xx")).toBeNull();
    expect(normalizePersonName("  María   Pérez ")).toBe("maría pérez");
  });
});

describe("Fase M5 customer portal", () => {
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

  async function registerUser(email: string, businessName: string) {
    const res = await api()
      .post("/v1/auth/register")
      .send({ email, password: "password12", businessName })
      .expect(201);
    return res.body as {
      user: { id: string; email: string };
      business: { id: string; name: string };
      accessToken: string;
      refreshToken: string;
    };
  }

  function adminHeaders(token: string, businessId: string) {
    return {
      Authorization: `Bearer ${token}`,
      "X-Business-Id": businessId,
    };
  }

  async function createCustomer(
    token: string,
    businessId: string,
    name: string,
  ) {
    const res = await api()
      .post("/v1/customers")
      .set(adminHeaders(token, businessId))
      .send({ name })
      .expect(201);
    return res.body as { id: string; code: string; name: string; debt: number };
  }

  async function customerLogin(code: string, name: string, status = 201) {
    return api().post("/v1/customer-access/login").send({ code, name }).expect(status);
  }

  it("assigns sequential codes and does not reuse an archived number", async () => {
    const admin = await registerUser("m5-codes@test.co", "Puesto Códigos");
    const a = await createCustomer(admin.accessToken, admin.business.id, "Ana");
    expect(a.code).toBe("DC-0001");
    const b = await createCustomer(admin.accessToken, admin.business.id, "Beto");
    expect(b.code).toBe("DC-0002");

    await prisma.customer.update({
      where: { id: a.id },
      data: { archivedAt: new Date() },
    });

    const c = await createCustomer(admin.accessToken, admin.business.id, "Cata");
    expect(c.code).toBe("DC-0003");
  });

  it("identifies by code + name (case/space insensitive)", async () => {
    const admin = await registerUser("m5-id@test.co", "Puesto Id");
    const customer = await createCustomer(
      admin.accessToken,
      admin.business.id,
      "María Pérez",
    );
    expect(customer.code).toBe("DC-0001");

    const ok = await customerLogin(" dc-1 ", "  MARÍA   PÉREZ ");
    expect(ok.body.customer.code).toBe("DC-0001");
    expect(ok.body.customer.name).toBe("María Pérez");
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.refreshToken).toBeTruthy();
    const payload = jwt.decode(ok.body.accessToken) as {
      typ?: string;
      sub?: string;
      businessId?: string;
    };
    expect(payload.typ).toBe("customer");
    expect(payload.sub).toBe(customer.id);
    expect(payload.businessId).toBe(admin.business.id);
  });

  it("rejects wrong name, missing customer, and archived with the same copy", async () => {
    const admin = await registerUser("m5-fail@test.co", "Puesto Fail");
    const live = await createCustomer(
      admin.accessToken,
      admin.business.id,
      "Rosa Viva",
    );
    const archived = await createCustomer(
      admin.accessToken,
      admin.business.id,
      "Rosa Archivo",
    );
    await prisma.customer.update({
      where: { id: archived.id },
      data: { archivedAt: new Date() },
    });

    const wrong = await customerLogin(live.code, "Otro Nombre", 401);
    expect(wrong.body.error.code).toBe("UNAUTHORIZED");
    expect(wrong.body.error.message).toBe("No pudimos identificarte.");

    const missing = await customerLogin("DC-9999", "Rosa Viva", 401);
    expect(missing.body.error.message).toBe("No pudimos identificarte.");

    const dead = await customerLogin(archived.code, "Rosa Archivo", 401);
    expect(dead.body.error.message).toBe("No pudimos identificarte.");
    expect(JSON.stringify(dead.body)).not.toMatch(/archiv/i);
  });

  it("isolates customers in the same business and across businesses", async () => {
    const a = await registerUser("m5-iso-a@test.co", "Negocio Iso A");
    const b = await registerUser("m5-iso-b@test.co", "Negocio Iso B");
    const rosa = await createCustomer(a.accessToken, a.business.id, "Rosa");
    const pedro = await createCustomer(a.accessToken, a.business.id, "Pedro");
    const other = await createCustomer(b.accessToken, b.business.id, "Luisa");
    expect(rosa.code).toBe("DC-0001");
    expect(other.code).toBe("DC-0001");

    const productA = await api()
      .post("/v1/products")
      .set(adminHeaders(a.accessToken, a.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Chicle A", price: 500, stock: 20, avgCost: 200 })
      .expect(201);
    const productB = await api()
      .post("/v1/products")
      .set(adminHeaders(b.accessToken, b.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Chicle B", price: 800, stock: 20, avgCost: 200 })
      .expect(201);

    await api()
      .post("/v1/sales")
      .set(adminHeaders(a.accessToken, a.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: productA.body.id, qty: 1, unitPrice: 500 }],
        paymentKind: "credit",
        customerId: rosa.id,
        amountReceived: 0,
      })
      .expect(201);
    await api()
      .post("/v1/sales")
      .set(adminHeaders(a.accessToken, a.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: productA.body.id, qty: 1, unitPrice: 500 }],
        paymentKind: "credit",
        customerId: pedro.id,
        amountReceived: 0,
      })
      .expect(201);
    await api()
      .post("/v1/sales")
      .set(adminHeaders(b.accessToken, b.business.id))
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: productB.body.id, qty: 1, unitPrice: 800 }],
        paymentKind: "credit",
        customerId: other.id,
        amountReceived: 0,
      })
      .expect(201);

    const rosaSession = await customerLogin(rosa.code, "Rosa");
    const ledger = await api()
      .get("/v1/customer/me/ledger")
      .set("Authorization", `Bearer ${rosaSession.body.accessToken}`)
      .expect(200);

    expect(ledger.body.customer.id).toBe(rosa.id);
    expect(ledger.body.customer.debt).toBe(500);
    expect(ledger.body.sales).toHaveLength(1);
    expect(ledger.body.sales[0].saleTotal).toBe(500);
    const blob = JSON.stringify(ledger.body);
    expect(blob).not.toContain(pedro.id);
    expect(blob).not.toContain(other.id);
    expect(blob).not.toContain("Chicle B");
    expect(blob).not.toMatch(/unitCost/);
    expect(blob).not.toMatch(/productId/);
    expect(blob).not.toMatch(/saleLineId/);
  });

  it("fails closed when the same code+name exists in two businesses", async () => {
    const a = await registerUser("m5-amb-a@test.co", "Ambiguo A");
    const b = await registerUser("m5-amb-b@test.co", "Ambiguo B");
    await createCustomer(a.accessToken, a.business.id, "Rosa");
    await createCustomer(b.accessToken, b.business.id, "Rosa");
    const res = await customerLogin("DC-0001", "Rosa", 401);
    expect(res.body.error.message).toBe("No pudimos identificarte.");
  });

  it("rejects invalid, expired, refresh, and admin tokens on customer routes", async () => {
    const admin = await registerUser("m5-tok@test.co", "Puesto Tok");
    const customer = await createCustomer(
      admin.accessToken,
      admin.business.id,
      "Lina",
    );
    const session = await customerLogin(customer.code, "Lina");

    await api().get("/v1/customer/me").expect(401);
    await api()
      .get("/v1/customer/me")
      .set("Authorization", "Bearer not-a-jwt")
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("UNAUTHORIZED"));

    const expired = jwt.sign(
      {
        sub: customer.id,
        businessId: admin.business.id,
        typ: "customer",
      },
      { expiresIn: "-1s" },
    );
    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${expired}`)
      .expect(401);

    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${session.body.refreshToken}`)
      .expect(401);

    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .expect(401);

    await api()
      .post("/v1/customer-access/refresh")
      .send({ refreshToken: session.body.accessToken })
      .expect(401);

    const expiredRefresh = jwt.sign(
      {
        sub: customer.id,
        businessId: admin.business.id,
        typ: "customer_refresh",
      },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: "-1s" },
    );
    await api()
      .post("/v1/customer-access/refresh")
      .send({ refreshToken: expiredRefresh })
      .expect(401);
  });

  it("does not let a customer token hit admin routes", async () => {
    const admin = await registerUser("m5-leak@test.co", "Puesto Leak");
    const customer = await createCustomer(
      admin.accessToken,
      admin.business.id,
      "Nora",
    );
    const session = await customerLogin(customer.code, "Nora");
    const bearer = `Bearer ${session.body.accessToken}`;

    await api()
      .get("/v1/me")
      .set("Authorization", bearer)
      .expect(401)
      .expect((r) => expect(r.body.error.code).toBe("UNAUTHORIZED"));

    await api()
      .get("/v1/products")
      .set("Authorization", bearer)
      .set("X-Business-Id", admin.business.id)
      .expect(401);

    await api()
      .get(`/v1/customers/${customer.id}/ledger`)
      .set("Authorization", bearer)
      .set("X-Business-Id", admin.business.id)
      .expect(401);

    await api()
      .post("/v1/sales")
      .set("Authorization", bearer)
      .set("X-Business-Id", admin.business.id)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: randomUUID(), qty: 1 }],
        paymentKind: "paid",
        amountReceived: 0,
      })
      .expect(401);
  });

  it("returns a public ledger with sale, fiado, partial, payment, initial debt, and return", async () => {
    const admin = await registerUser("m5-led@test.co", "Puesto Ledger");
    const h = adminHeaders(admin.accessToken, admin.business.id);
    const product = await api()
      .post("/v1/products")
      .set(h)
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Galleta", price: 500, stock: 40, avgCost: 200 })
      .expect(201);
    const customer = await createCustomer(
      admin.accessToken,
      admin.business.id,
      "Doña Ledger",
    );

    await api()
      .post(`/v1/customers/${customer.id}/initial-debts`)
      .set(h)
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 45200, note: "deuda anterior" })
      .expect(201);

    await api()
      .post("/v1/sales")
      .set(h)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: product.body.id, qty: 2, unitPrice: 500 }],
        paymentKind: "paid",
        customerId: customer.id,
        amountReceived: 1000,
        method: "Efectivo",
      })
      .expect(201);

    const fiado = await api()
      .post("/v1/sales")
      .set(h)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: product.body.id, qty: 2, unitPrice: 500 }],
        paymentKind: "credit",
        customerId: customer.id,
        amountReceived: 0,
      })
      .expect(201);

    await api()
      .post("/v1/sales")
      .set(h)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: product.body.id, qty: 2, unitPrice: 500 }],
        paymentKind: "partial",
        customerId: customer.id,
        amountReceived: 500,
        method: "Nequi",
      })
      .expect(201);

    await api()
      .post(`/v1/customers/${customer.id}/payments`)
      .set(h)
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 2000, method: "Efectivo" })
      .expect(201);

    const ret = await api()
      .post(`/v1/sales/${fiado.body.id}/returns`)
      .set(h)
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ saleLineId: fiado.body.lines[0].id, qty: 1 }],
      })
      .expect(201);
    expect(ret.body.debtReduced).toBe(500);
    expect(ret.body.refundAmount).toBe(0);

    const session = await customerLogin(customer.code, "Doña Ledger");
    const me = await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${session.body.accessToken}`)
      .expect(200);
    // 45200 + 1000 fiado + 500 partial − 2000 abono − 500 devolución
    expect(me.body.debt).toBe(44200);
    expect(me.body.code).toBe("DC-0001");
    expect(me.body).not.toHaveProperty("phone");

    const ledger = await api()
      .get("/v1/customer/me/ledger")
      .set("Authorization", `Bearer ${session.body.accessToken}`)
      .expect(200);

    expect(ledger.body.customer.debt).toBe(44200);
    expect(ledger.body.initials).toHaveLength(1);
    expect(ledger.body.initials[0].amount).toBe(45200);
    expect(ledger.body.payments).toHaveLength(1);
    expect(ledger.body.payments[0].amount).toBe(2000);
    expect(ledger.body.payments[0].method).toBe("Efectivo");
    expect(ledger.body.sales).toHaveLength(3);

    const paid = ledger.body.sales.find((s: { paymentKind: string }) => s.paymentKind === "paid");
    const credit = ledger.body.sales.find((s: { paymentKind: string }) => s.paymentKind === "credit");
    const partial = ledger.body.sales.find((s: { paymentKind: string }) => s.paymentKind === "partial");
    expect(paid.saleTotal).toBe(1000);
    expect(paid.credit).toBe(0);
    expect(credit.credit).toBe(1000);
    expect(credit.returns).toHaveLength(1);
    expect(credit.returns[0].debtReduced).toBe(500);
    expect(partial.amountReceived).toBe(500);
    expect(partial.credit).toBe(500);

    const line = paid.lines[0];
    expect(line.productName).toBe("Galleta");
    expect(line.qty).toBe(2);
    expect(line.unitPrice).toBe(500);
    expect(line).not.toHaveProperty("unitCost");
    expect(line).not.toHaveProperty("productId");
    expect(credit.returns[0].lines[0]).not.toHaveProperty("unitCost");
    expect(credit.returns[0].lines[0]).not.toHaveProperty("saleLineId");
    expect(credit.returns[0].lines[0]).not.toHaveProperty("productId");
    expect(JSON.stringify(ledger.body)).not.toMatch(/unitCost/);
  });

  it("refreshes a customer session and logs out without revoking the access JWT", async () => {
    const admin = await registerUser("m5-ref@test.co", "Puesto Refresh C");
    const customer = await createCustomer(
      admin.accessToken,
      admin.business.id,
      "Eva",
    );
    const session = await customerLogin(customer.code, "Eva");

    const rotated = await api()
      .post("/v1/customer-access/refresh")
      .send({ refreshToken: session.body.refreshToken })
      .expect(201);
    expect(rotated.body.accessToken).toBeTruthy();
    expect(rotated.body.customer.code).toBe("DC-0001");

    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${rotated.body.accessToken}`)
      .expect(200);

    await api()
      .post("/v1/customer-access/logout")
      .set("Authorization", `Bearer ${rotated.body.accessToken}`)
      .expect(201)
      .expect((r) => expect(r.body.ok).toBe(true));

    await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${rotated.body.accessToken}`)
      .expect(200);
  });
});
