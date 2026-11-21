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

describe("AUDIT D3 integridad financiera", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  let token = "";
  let biz = "";

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = [REDACTED]
    process.env.JWT_SECRET = "[REDACTED]";
    process.env.JWT_REFRESH_SECRET = "[REDACTED]";

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

    const owner = await seedOwner(app, "[REDACTED]", "M6");
    token = [REDACTED];
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

  it("POST /customers without Idempotency-Key is VALIDATION", async () => {
    await api()
      .post("/v1/customers")
      .set(auth())
      .send({ name: "Sin clave" })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("VALIDATION"));
  });

  const post = (url: string, body: object, key: string = randomUUID()) =>
    api().post(url).set(auth()).set("Idempotency-Key", key).send(body);

  async function reconstruct() {
    const rows = await prisma.$queryRaw<Array<{ id: string; debt: bigint; recon: bigint }>>`
      SELECT c.id, c.debt,
        COALESCE((SELECT SUM(amount) FROM initial_debts d WHERE d.customer_id=c.id),0)
      + COALESCE((SELECT SUM(credit) FROM sales s WHERE s.customer_id=c.id),0)
      - COALESCE((SELECT SUM(amount) FROM customer_payments p WHERE p.customer_id=c.id),0)
      - COALESCE((SELECT SUM(r.debt_reduced) FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=c.id),0) AS recon
      FROM customers c WHERE c.business_id=${biz}::uuid`;
    return rows;
  }

  let productId = "";
  let ana = "";
  let beto = "";

  it("setup: producto, clientes, caja", async () => {
    const p = await post("/v1/products", { name: "Bombón", price: 1000, stock: 100, avgCost: 400 });
    console.log("product status", p.status, JSON.stringify(p.body).slice(0, 200));
    expect(p.status).toBeLessThan(300);
    productId = p.body.id;
    ana = (await post("/v1/customers", { name: "Ana" })).body.id;
    beto = (await post("/v1/customers", { name: "Beto" })).body.id;
    const s = await post("/v1/cash/sessions", { openingFloat: 5000 });
    expect(s.status).toBeLessThan(300);
  });

  it("I1: operaciones mixtas -> debt almacenada == reconstruida", async () => {
    const r1 = await post(`/v1/customers/${ana}/initial-debts`, { amount: 3000 });
    expect(r1.status).toBeLessThan(300);
    const fiada = await post("/v1/sales", { paymentKind: "credit", customerId: ana, amountReceived: 0, lines: [{ productId, qty: 5 }] });
    expect(fiada.status).toBeLessThan(300);
    const parcial = await post("/v1/sales", { paymentKind: "partial", customerId: ana, amountReceived: 1000, method: "Nequi", lines: [{ productId, qty: 3 }] });
    expect(parcial.status).toBeLessThan(300);
    const pagada = await post("/v1/sales", { paymentKind: "paid", amountReceived: 2000, method: "Efectivo", lines: [{ productId, qty: 2 }] });
    expect(pagada.status).toBeLessThan(300);
    const ab = await post(`/v1/customers/${ana}/payments`, { amount: 2500, method: "Efectivo" });
    expect(ab.status).toBeLessThan(300);
    const dev = await post(`/v1/sales/${fiada.body.id}/returns`, { lines: [{ saleLineId: fiada.body.lines[0].id, qty: 2 }] });
    console.log("return", dev.status, JSON.stringify(dev.body).slice(0, 300));
    const over = await post(`/v1/customers/${ana}/payments`, { amount: 999999, method: "Efectivo" });
    console.log("overpay", over.status, JSON.stringify(over.body));
    const rows = await reconstruct();
    console.log("I1 rows", JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
    for (const r of rows) expect(Number(r.debt)).toBe(Number(r.recon));
    // 3000 + 5000 + 2000 - 2500 - 2000 = 5500
    const a = rows.find((r) => r.id === ana)!;
    expect(Number(a.debt)).toBe(5500);
  });

  it("I2: mismo requestId, OTRO cliente y monto -> respuesta silenciosa del abono original", async () => {
    await post(`/v1/customers/${beto}/initial-debts`, { amount: 4000 });
    const key = randomUUID();
    const first = await post(`/v1/customers/${ana}/payments`, { amount: 500, method: "Efectivo" }, key);
    const second = await post(`/v1/customers/${beto}/payments`, { amount: 4000, method: "Nequi" }, key);
    console.log("I2 first", first.status, JSON.stringify(first.body));
    console.log("I2 second", second.status, JSON.stringify(second.body));
    const b = await api().get(`/v1/customers/${beto}`).set(auth());
    console.log("I2 beto debt after", b.body.debt);
    expect(second.status).toBeLessThan(300);
    expect(second.body.customerId).toBe(ana);
    expect(b.body.debt).toBe(4000);
  });

  it("I3: dos abonos concurrentes por el total (requestIds distintos) -> uno 409", async () => {
    const b = await api().get(`/v1/customers/${beto}`).set(auth());
    const debt = b.body.debt;
    const [x, y] = await Promise.all([
      post(`/v1/customers/${beto}/payments`, { amount: debt, method: "Efectivo" }),
      post(`/v1/customers/${beto}/payments`, { amount: debt, method: "Efectivo" }),
    ]);
    console.log("I3 statuses", x.status, y.status, JSON.stringify(y.body), JSON.stringify(x.body));
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    const rows = await reconstruct();
    for (const r of rows) expect(Number(r.debt)).toBe(Number(r.recon));
  });

  it("I4: misma clave, doble tap concurrente -> un solo abono", async () => {
    const key = randomUUID();
    const [x, y] = await Promise.all([
      post(`/v1/customers/${ana}/payments`, { amount: 100, method: "Efectivo" }, key),
      post(`/v1/customers/${ana}/payments`, { amount: 100, method: "Efectivo" }, key),
    ]);
    console.log("I4", x.status, y.status, x.body.id === y.body.id);
    const n = await prisma.customerPayment.count({ where: { businessId: biz, requestId: key } });
    const m = await prisma.cashMove.count({ where: { businessId: biz, requestId: key } });
    console.log("I4 payments", n, "cashMoves", m);
    expect(n).toBe(1);
    expect(m).toBe(1);
  });

  it("C1: caja esperada excluye Nequi; cierre doble con otra clave -> 409; abono tras cierre -> CLOSED_DAY", async () => {
    const today = await api().get("/v1/cash/today").set(auth());
    console.log("C1 today", JSON.stringify(today.body).slice(0, 600));
    const sid = today.body.session?.id ?? today.body.id;
    const close = await post(`/v1/cash/sessions/${sid}/close`, { countedEfectivo: 0 });
    console.log("C1 close", close.status, JSON.stringify(close.body));
    const close2 = await post(`/v1/cash/sessions/${sid}/close`, { countedEfectivo: 0 });
    console.log("C1 close2", close2.status, JSON.stringify(close2.body));
    const after = await post(`/v1/customers/${ana}/payments`, { amount: 100, method: "Efectivo" });
    console.log("C1 payment after close", after.status, JSON.stringify(after.body));
    expect(close2.status).toBe(409);
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe("CLOSED_DAY");
  });
});
