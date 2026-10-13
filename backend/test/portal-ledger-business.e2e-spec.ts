/**
 * Ticket B-4b: portal ledger hardening. The customer portal ledger is scoped
 * only by the verified customer token (customerId + businessId).
 *  AC1 cross-business: zero foreign rows.
 *  AC2 forged / foreign / missing customer token => 401, one message.
 *  AC3 X-Business-Id on a portal request changes nothing.
 *  AC5 public shape: no cost or internal fields.
 */
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

const PIN = "482915";
const IDENTIFY_FAIL = "No pudimos identificarte.";

type Owner = Awaited<ReturnType<typeof seedOwner>>;

describe("portal ledger is scoped by the customer token business", () => {
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
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
  const admin = (o: Owner) => ({
    Authorization: `Bearer ${o.accessToken}`,
    "X-Business-Id": o.business.id,
  });

  /** Customer with initial debt, a credit sale (+ return) and a payment. */
  async function populated(o: Owner, label: string, price: number) {
    const customer = await api()
      .post("/v1/customers")
      .set(admin(o))
      .set("Idempotency-Key", randomUUID())
      .send({ name: `Rosa ${label}` })
      .expect(201);
    const id = customer.body.id as string;
    await api().post(`/v1/customers/${id}/pin`).set(admin(o)).send({ pin: PIN }).expect(201);
    await api()
      .post(`/v1/customers/${id}/initial-debts`)
      .set(admin(o))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: price * 10, note: `deuda-${label}` })
      .expect(201);
    const product = await api()
      .post("/v1/products")
      .set(admin(o))
      .set("Idempotency-Key", randomUUID())
      .send({ name: `Gomita ${label}`, price, stock: 50, avgCost: Math.floor(price / 3) })
      .expect(201);
    const sale = await api()
      .post("/v1/sales")
      .set(admin(o))
      .set("Idempotency-Key", randomUUID())
      .send({
        lines: [{ productId: product.body.id, qty: 2, unitPrice: price }],
        paymentKind: "credit",
        customerId: id,
        amountReceived: 0,
        note: `venta-${label}`,
      })
      .expect(201);
    const saleLineId = sale.body.lines[0].id as string;
    await api()
      .post(`/v1/sales/${sale.body.id}/returns`)
      .set(admin(o))
      .set("Idempotency-Key", randomUUID())
      .send({ lines: [{ saleLineId, qty: 1 }], note: `devol-${label}` })
      .expect(201);
    const payment = await api()
      .post(`/v1/customers/${id}/payments`)
      .set(admin(o))
      .set("Idempotency-Key", randomUUID())
      .send({ amount: price, method: "Nequi", note: `abono-privado-${label}` })
      .expect(201);
    return {
      id,
      code: customer.body.code as string,
      productId: product.body.id as string,
      saleId: sale.body.id as string,
      saleLineId,
      paymentId: payment.body.id as string,
      label,
    };
  }

  async function login(code: string, businessId: string) {
    const res = await api()
      .post("/v1/customer-access/login")
      .send({ code, pin: PIN, businessId })
      .expect(201);
    return res.body.accessToken as string;
  }

  let a: Owner;
  let b: Owner;
  let left: Awaited<ReturnType<typeof populated>>;
  let right: Awaited<ReturnType<typeof populated>>;

  beforeAll(async () => {
    a = await seedOwner(app, "ledger-a@test.co", "Ledger A");
    b = await seedOwner(app, "ledger-b@test.co", "Ledger B");
    left = await populated(a, "A", 6000);
    right = await populated(b, "B", 7000);
  }, 120000);

  it("AC1: business A token returns zero rows from business B (same customer code)", async () => {
    expect(left.code).toBe(right.code);
    const token = await login(left.code, a.business.id);
    const res = await api()
      .get("/v1/customer/me/ledger")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(res.body.customer.id).toBe(left.id);
    expect(res.body.initials).toHaveLength(1);
    expect(res.body.sales).toHaveLength(1);
    expect(res.body.sales[0].id).toBe(left.saleId);
    expect(res.body.sales[0].returns).toHaveLength(1);
    expect(res.body.payments).toHaveLength(1);
    expect(res.body.payments[0].id).toBe(left.paymentId);

    const blob = JSON.stringify(res.body);
    for (const foreign of [right.id, right.productId, right.saleId, right.paymentId, right.saleLineId]) {
      expect(blob).not.toContain(foreign);
    }
    expect(blob).not.toContain("deuda-B");
    expect(blob).not.toContain("venta-B");
    expect(blob).not.toContain("Gomita B");
    expect(blob).not.toContain(b.business.id);

    // Mirror: B sees only B.
    const tokenB = await login(right.code, b.business.id);
    const resB = await api()
      .get("/v1/customer/me/ledger")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);
    expect(resB.body.customer.id).toBe(right.id);
    const blobB = JSON.stringify(resB.body);
    for (const foreign of [left.id, left.productId, left.saleId, left.paymentId]) {
      expect(blobB).not.toContain(foreign);
    }
  });

  it("AC2: forged businessId, foreign customer, missing or archived customer => same 401", async () => {
    const forgedBusiness = jwt.sign({ sub: left.id, businessId: b.business.id, typ: "customer" });
    const foreignCustomer = jwt.sign({ sub: right.id, businessId: a.business.id, typ: "customer" });
    const missing = jwt.sign({ sub: randomUUID(), businessId: a.business.id, typ: "customer" });
    const ghostBusiness = jwt.sign({ sub: left.id, businessId: randomUUID(), typ: "customer" });

    const archivedCustomer = await api()
      .post("/v1/customers")
      .set(admin(a))
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Archivada" })
      .expect(201);
    await prisma.customer.update({
      where: { id: archivedCustomer.body.id },
      data: { archivedAt: new Date() },
    });
    const archived = jwt.sign({
      sub: archivedCustomer.body.id,
      businessId: a.business.id,
      typ: "customer",
    });

    const bodies: unknown[] = [];
    for (const t of [forgedBusiness, foreignCustomer, missing, ghostBusiness, archived]) {
      const res = await api()
        .get("/v1/customer/me/ledger")
        .set("Authorization", `Bearer ${t}`)
        .expect(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
      expect(res.body.error.message).toBe(IDENTIFY_FAIL);
      bodies.push(res.body);
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);

    // Re-signed payload with a tampered businessId but an invalid signature.
    const valid = await login(left.code, a.business.id);
    const [h, , s] = valid.split(".");
    const payload = Buffer.from(
      JSON.stringify({ sub: left.id, businessId: b.business.id, typ: "customer" }),
    ).toString("base64url");
    const tampered = await api()
      .get("/v1/customer/me/ledger")
      .set("Authorization", `Bearer ${h}.${payload}.${s}`)
      .expect(401);
    expect(tampered.body.error.code).toBe("UNAUTHORIZED");
    expect(JSON.stringify(tampered.body)).not.toContain(left.id);
    expect(JSON.stringify(tampered.body)).not.toContain(b.business.id);
  });

  it("AC3: X-Business-Id header on a portal request is ignored", async () => {
    const token = await login(left.code, a.business.id);
    const plain = await api()
      .get("/v1/customer/me/ledger")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    for (const header of [b.business.id, randomUUID(), "not-a-uuid"]) {
      const withHeader = await api()
        .get("/v1/customer/me/ledger")
        .set("Authorization", `Bearer ${token}`)
        .set("X-Business-Id", header)
        .expect(200);
      expect(withHeader.body).toEqual(plain.body);
    }
    const me = await api()
      .get("/v1/customer/me")
      .set("Authorization", `Bearer ${token}`)
      .set("X-Business-Id", b.business.id)
      .expect(200);
    expect(me.body.id).toBe(left.id);
  });

  it("AC5: public ledger has no costs, saleLineId, payment note or internal ids", async () => {
    const token = await login(left.code, a.business.id);
    const res = await api()
      .get("/v1/customer/me/ledger")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const blob = JSON.stringify(res.body);
    for (const banned of ["unitCost", "avgCost", "saleLineId", "businessId", "customerId", "pinHash", "abono-privado-A"]) {
      expect(blob).not.toContain(banned);
    }
    expect(Object.keys(res.body).sort()).toEqual(["customer", "initials", "payments", "sales"]);
    expect(Object.keys(res.body.customer).sort()).toEqual(["code", "createdAt", "debt", "id", "name"]);
    expect(Object.keys(res.body.payments[0]).sort()).toEqual(["amount", "createdAt", "id", "method", "occurredOn"]);
    expect(Object.keys(res.body.sales[0].lines[0]).sort()).toEqual(
      ["id", "lineTotal", "productId", "productName", "qty", "unitPrice"],
    );
    expect(Object.keys(res.body.sales[0].returns[0].lines[0]).sort()).toEqual(["id", "qty", "unitPrice"]);
  });
});
