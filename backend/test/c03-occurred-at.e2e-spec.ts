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

describe("C03 occurredAt vs syncedAt (DC-06)", () => {
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

    const owner = await seedOwner(app, "c03@test.co", "C03");
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

  it("C03-A2: sales and customer_payments have occurred_at and synced_at", async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('sales', 'customer_payments')
        AND column_name IN ('occurred_at', 'synced_at')
    `;
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    expect(have.has("sales.occurred_at")).toBe(true);
    expect(have.has("sales.synced_at")).toBe(true);
    expect(have.has("customer_payments.occurred_at")).toBe(true);
    expect(have.has("customer_payments.synced_at")).toBe(true);
  });

  it("C03-A1/A3: POST abono with occurredAt −3h keeps it and sets syncedAt ≈ now", async () => {
    const occ = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const before = Date.now();
    const r = await post(`/v1/customers/${ana}/payments`, {
      amount: 1_000,
      method: "Efectivo",
      occurredAt: occ,
    });
    const after = Date.now();
    expect(r.status).toBe(201);
    expect(Math.abs(new Date(r.body.occurredAt).getTime() - new Date(occ).getTime())).toBeLessThan(1000);
    expect(r.body.syncedAt).toBeTruthy();
    const syncedMs = new Date(r.body.syncedAt).getTime();
    expect(syncedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(syncedMs).toBeLessThanOrEqual(after + 1000);
    expect(new Date(r.body.occurredAt).getTime()).not.toBe(syncedMs);

    const row = await prisma.customerPayment.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(Math.abs(row.occurredAt!.getTime() - new Date(occ).getTime())).toBeLessThan(1000);
    expect(row.syncedAt).toBeTruthy();
    expect(Math.abs(row.syncedAt!.getTime() - syncedMs)).toBeLessThan(1000);
  });

  it("C03-A4: POST sale with occurredAt −3h is 2xx and exposes both fields", async () => {
    const occ = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    const before = Date.now();
    const r = await post("/v1/sales", {
      lines: [{ productId, qty: 1 }],
      paymentKind: "paid",
      amountReceived: 1000,
      method: "Efectivo",
      occurredAt: occ,
    });
    expect(r.status).toBe(201);
    expect(Math.abs(new Date(r.body.occurredAt).getTime() - new Date(occ).getTime())).toBeLessThan(1000);
    expect(r.body.syncedAt).toBeTruthy();
    expect(new Date(r.body.syncedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(r.body.occurredAt).getTime()).not.toBe(new Date(r.body.syncedAt).getTime());

    const row = await prisma.sale.findUniqueOrThrow({ where: { id: r.body.id } });
    expect(Math.abs(row.occurredAt!.getTime() - new Date(occ).getTime())).toBeLessThan(1000);
    expect(row.syncedAt).toBeTruthy();
  });

  it("C03-A5: online abono without occurredAt still returns both fields ≈ now", async () => {
    const before = Date.now();
    const r = await post(`/v1/customers/${ana}/payments`, { amount: 500, method: "Efectivo" });
    const after = Date.now();
    expect(r.status).toBe(201);
    expect(r.body.occurredAt).toBeTruthy();
    expect(r.body.syncedAt).toBeTruthy();
    expect(Math.abs(new Date(r.body.occurredAt).getTime() - new Date(r.body.syncedAt).getTime())).toBeLessThan(1000);
    expect(new Date(r.body.occurredAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(r.body.occurredAt).getTime()).toBeLessThanOrEqual(after + 1000);
  });

  it("C03-A6: occurredAt +48h is 4xx", async () => {
    const future = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const r = await post(`/v1/customers/${ana}/payments`, {
      amount: 500,
      method: "Efectivo",
      occurredAt: future,
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });

  it("C03-A7: ledger payments expose occurredAt", async () => {
    const r = await api().get(`/v1/customers/${ana}/ledger`).set(auth());
    expect(r.status).toBe(200);
    expect(r.body.payments.length).toBeGreaterThan(0);
    for (const p of r.body.payments) {
      expect(p.occurredAt).toBeTruthy();
    }
  });

  it("C02: same key with a different occurredAt still replays (hash excludes occurredAt)", async () => {
    const key = randomUUID();
    const a = await post(
      `/v1/customers/${ana}/payments`,
      { amount: 700, method: "Efectivo" },
      key,
    );
    const b = await post(
      `/v1/customers/${ana}/payments`,
      {
        amount: 700,
        method: "Efectivo",
        occurredAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
      },
      key,
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
  });

  it("Decision 16: occurredAt older than 30 days is rejected", async () => {
    const tooOld = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
    const r = await post(`/v1/customers/${ana}/payments`, {
      amount: 500,
      method: "Efectivo",
      occurredAt: tooOld,
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION");
  });

  it("Decision 28: other-day occurredAt is kept and occurredOn is the server day", async () => {
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    const r = await post("/v1/sales", {
      lines: [{ productId, qty: 1 }],
      paymentKind: "paid",
      amountReceived: 1000,
      method: "Efectivo",
      occurredAt: yesterday,
    });
    expect(r.status).toBe(201);
    expect(Math.abs(new Date(r.body.occurredAt).getTime() - new Date(yesterday).getTime())).toBeLessThan(1000);
    const control = await post(`/v1/customers/${ana}/payments`, { amount: 100, method: "Nequi" });
    expect(control.status).toBe(201);
    expect(r.body.occurredOn).toBe(control.body.occurredOn);
  });
});
