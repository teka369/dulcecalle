import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { HttpRepository } from "../../src/data/http/repository";
import { pwaStorage } from "../../src/data/backend";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { applyOwnerSession, seedOwner } from "./seed-owner";

installBigIntJson();

describe("Fase M3 PWA HTTP reads + playable domain", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let api: HttpRepository;

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
    await app.listen(0, "127.0.0.1");
    api = new HttpRepository(`${await app.getUrl()}/v1`);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  it("PWA storage is HTTP", () => {
    expect(pwaStorage()).toBe("http");
  });

  it("register → product → sale → stats / ledger / moves", async () => {
    const reg = await seedOwner(app, "m3@test.co", "Puesto M3");
    applyOwnerSession(api.session, reg);
    expect(reg.business.id).toBeTruthy();
    expect(api.session.businessId).toBe(reg.business.id);

    const emptyStats = await api.stats.get("hoy");
    expect(emptyStats.emptyPeriod).toBe(true);
    expect(emptyStats.ventas).toBe(0);
    expect(emptyStats.porCobrar).toBe(0);

    const product = await api.products.create(
      { name: "Chicle", price: 500, stock: 20, avgCost: 200 },
      randomUUID(),
    );
    expect(product.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const moves = await api.inventory.moves(product.id);
    expect(moves.some((m) => m.reason === "inicial" && m.delta === 20)).toBe(
      true,
    );

    const customer = await api.customers.create({ name: "Doña Rosa" });
    await api.customers.initialDebt(
      customer.id,
      { amount: 45200, note: "deuda anterior" },
      randomUUID(),
    );

    const sale = await api.sales.create(
      {
        lines: [{ productId: product.id, qty: 2, unitPrice: 500 }],
        paymentKind: "credit",
        customerId: customer.id,
        amountReceived: 0,
      },
      randomUUID(),
    );
    expect(sale.saleTotal).toBe(1000);
    expect(sale.credit).toBe(1000);

    const ledger = await api.customers.ledger(customer.id);
    expect(ledger.initials).toHaveLength(1);
    expect(ledger.sales).toHaveLength(1);
    expect(Number(ledger.initials[0].amount)).toBe(45200);

    const owing = await api.customers.get(customer.id);
    expect(owing.debt).toBe(46200);

    const stats = await api.stats.get("hoy");
    expect(stats.emptyPeriod).toBe(false);
    expect(stats.ventas).toBe(1000);
    expect(stats.ventasCount).toBe(1);
    expect(stats.porCobrar).toBe(46200);
    expect(stats.valorInventario).toBe(200 * 18);

    const http = request(app.getHttpServer());
    const auth = {
      Authorization: `Bearer ${api.session.accessToken}`,
      "X-Business-Id": api.session.businessId as string,
    };

    await http.get("/v1/stats").set(auth).query({ period: "hoy" }).expect(200);
    await http
      .get(`/v1/products/${product.id}/moves`)
      .set(auth)
      .expect(200);
    await http
      .get(`/v1/customers/${customer.id}/ledger`)
      .set(auth)
      .expect(200);
    await http.get("/v1/expenses").set(auth).expect(200);
    await http.get("/v1/cash/moves").set(auth).expect(200);

    const supplier = await api.suppliers.create({ name: "Mayorista" });
    await api.inventory.surtir(
      product.id,
      {
        qty: 10,
        unitCost: 180,
        totalCost: 1800,
        method: "Efectivo",
        supplierId: supplier.id,
      },
      randomUUID(),
    );
    const surtidas = await api.suppliers.surtidas(supplier.id);
    expect(surtidas).toHaveLength(1);
    expect(surtidas[0].productName).toBe("Chicle");
    expect(surtidas[0].qty).toBe(10);
  });
});
