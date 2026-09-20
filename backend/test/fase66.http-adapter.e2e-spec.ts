import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import { AppModule } from "../src/app.module";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { ApiError } from "../../src/data/errors";
import { HttpRepository } from "../../src/data/http/repository";
import { pwaStorage } from "../../src/data/backend";
import { startLocalPostgres, type PgHandle } from "./pg-harness";

installBigIntJson();

describe("Fase 6.6 HTTP adapter ↔ Nest contract", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let api: HttpRepository;
  let apiB: HttpRepository;

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
    const base = `${await app.getUrl()}/v1`;
    api = new HttpRepository(base);
    apiB = new HttpRepository(base);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  it("PWA storage is HTTP (M3)", () => {
    expect(pwaStorage()).toBe("http");
  });

  it("auth: register, login, me, logout, 401", async () => {
    const reg = await api.auth.register({
      email: "a@test.co",
      password: "password12",
      businessName: "Puesto A",
    });
    expect(reg.accessToken).toBeTruthy();
    expect(reg.refreshToken).toBeTruthy();
    expect(reg.business.id).toBeTruthy();

    const me = await api.auth.me();
    expect(me.email).toBe("a@test.co");
    expect(me.memberships[0].role).toBe("owner");

    await api.auth.login("a@test.co", "password12");
    expect(api.session.accessToken).toBeTruthy();

    await expect(api.auth.login("a@test.co", "wrong-pass")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    } satisfies Partial<ApiError>);

    const guest = new HttpRepository(`${await app.getUrl()}/v1`);
    await expect(guest.auth.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("tenancy: 403 without membership, 404 for other-tenant ids", async () => {
    await apiB.auth.register({
      email: "b@test.co",
      password: "password12",
      businessName: "Puesto B",
    });

    const stolen = api.session.businessId!;
    apiB.auth.selectBusiness(stolen);
    await expect(apiB.products.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    apiB.auth.selectBusiness(
      (await apiB.auth.me()).memberships[0].businessId,
    );

    const pB = await apiB.products.create(
      { name: "Solo B", price: 100, stock: 2, avgCost: 40 },
      randomUUID(),
    );
    await expect(api.products.get(pB.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("products: create, list, gifted, NEED_COST, STOCK_VIA_MOVES, COP", async () => {
    const key = randomUUID();
    const gifted = await api.products.create(
      {
        name: "Galleta de chocolate italiano",
        price: 1000,
        stock: 15,
        avgCost: 0,
        gifted: true,
      },
      key,
    );
    expect(gifted.stock).toBe(15);
    expect(gifted.avgCost).toBe(0);
    expect(gifted).not.toHaveProperty("gifted");

    const again = await api.products.create(
      {
        name: "Galleta de chocolate italiano",
        price: 1000,
        stock: 15,
        gifted: true,
      },
      key,
    );
    expect(again.id).toBe(gifted.id);

    await expect(
      api.products.create(
        { name: "Olvido", price: 500, stock: 10, avgCost: 0, gifted: false },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NEED_COST", status: 409 });

    await expect(
      api.products.patch(gifted.id, { stock: 99 }),
    ).rejects.toMatchObject({ code: "STOCK_VIA_MOVES", status: 409 });

    const big = await api.products.create(
      { name: "Caja grande", price: 1000000, stock: 1, avgCost: 45000 },
      randomUUID(),
    );
    expect(big.price).toBe(1000000);
    expect(big.avgCost).toBe(45000);

    const listed = await api.products.list();
    expect(listed.some((p) => p.id === gifted.id)).toBe(true);
  });

  it("customers + sales + payments + cash (adapter does not compute economics)", async () => {
    const products = await api.products.list();
    const galleta = products.find((p) => p.name === "Galleta de chocolate italiano")!;
    const customer = await api.customers.create({ name: "Doña Test" });
    expect(customer.debt).toBe(0);

    const opened = await api.cash.open(5000);
    expect(opened.openingFloat).toBe(5000);
    const dup = await api.cash.open(9999);
    expect(dup.id).toBe(opened.id);
    expect(dup.openingFloat).toBe(5000);

    const saleKey = randomUUID();
    const sale = await api.sales.create(
      {
        lines: [{ productId: galleta.id, qty: 3, unitPrice: 1000 }],
        paymentKind: "paid",
        amountReceived: 3000,
        method: "Efectivo",
      },
      saleKey,
    );
    expect(sale.saleTotal).toBe(3000);
    expect(sale.credit).toBe(0);
    expect(sale.lines[0].unitCost).toBe(0);
    expect(sale.occurredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const retry = await api.sales.create(
      {
        lines: [{ productId: galleta.id, qty: 3, unitPrice: 1000 }],
        paymentKind: "paid",
        amountReceived: 3000,
        method: "Efectivo",
      },
      saleKey,
    );
    expect(retry.id).toBe(sale.id);

    const after = await api.products.get(galleta.id);
    expect(after.stock).toBe(12);

    const nequi = await api.sales.create(
      {
        lines: [{ productId: galleta.id, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 1000,
        method: "Nequi",
      },
      randomUUID(),
    );
    expect(nequi.method).toBe("Nequi");

    const credit = await api.sales.create(
      {
        lines: [{ productId: galleta.id, qty: 2 }],
        paymentKind: "credit",
        amountReceived: 0,
        customerId: customer.id,
      },
      randomUUID(),
    );
    expect(credit.credit).toBe(2000);

    const owing = await api.customers.get(customer.id);
    expect(owing.debt).toBe(2000);

    const payKey = randomUUID();
    const pay = await api.customers.pay(
      customer.id,
      { amount: 500, method: "Nequi" },
      payKey,
    );
    expect(pay.amount).toBe(500);
    const payAgain = await api.customers.pay(
      customer.id,
      { amount: 500, method: "Nequi" },
      payKey,
    );
    expect(payAgain.id).toBe(pay.id);

    await expect(
      api.customers.pay(
        customer.id,
        { amount: 99999, method: "Efectivo" },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "ABONO_EXCEEDS_DEBT", status: 409 });

    const today = await api.cash.today();
    expect(today.expected.efectivo).toBe(8000);
    expect(today.expected.nequi).toBe(1500);
    expect(today.session?.id).toBe(opened.id);

    const closed = await api.cash.close(opened.id, 8000);
    expect(closed.expectedEfectivo).toBe(8000);
    expect(closed.expectedNequi).toBe(1500);
    expect(closed.difference).toBe(0);

    await expect(api.cash.close(opened.id, 1)).rejects.toMatchObject({
      code: "SESSION_ALREADY_CLOSED",
      status: 409,
    });

    await expect(
      api.sales.create(
        {
          lines: [{ productId: galleta.id, qty: 1 }],
          paymentKind: "paid",
          amountReceived: 1000,
          method: "Efectivo",
        },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CLOSED_DAY", status: 409 });

    const fetched = await api.sales.get(sale.id);
    expect(fetched.lines[0].unitPrice).toBe(1000);
    expect(fetched.lines[0].unitCost).toBe(0);
  });
});
