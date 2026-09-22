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

describe("Business data reset (owner-only, transactional, tenant-scoped)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  let tokenA = "";
  let bizA = "";
  let tokenB = "";
  let bizB = "";
  let userIdA = "";

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

    const ownerA = await seedOwner(app, "reset-a@test.co", "ResetA");
    tokenA = ownerA.accessToken;
    bizA = ownerA.business.id;
    userIdA = ownerA.user.id;
    const ownerB = await seedOwner(app, "reset-b@test.co", "ResetB");
    tokenB = ownerB.accessToken;
    bizB = ownerB.business.id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());
  const authA = () => ({ Authorization: `Bearer ${tokenA}`, "X-Business-Id": bizA });
  const authB = () => ({ Authorization: `Bearer ${tokenB}`, "X-Business-Id": bizB });

  async function seedBusinessData(
    auth: Record<string, string>,
    name: string,
  ): Promise<string> {
    await api()
      .post("/v1/products")
      .set(auth)
      .set("Idempotency-Key", randomUUID())
      .send({ name, price: 1000, stock: 5, avgCost: 100 })
      .expect(201);
    const customer = await api()
      .post("/v1/customers")
      .set(auth)
      .set("Idempotency-Key", randomUUID())
      .send({ name: `${name}-cli` })
      .expect(201);
    await api()
      .post("/v1/expenses")
      .set(auth)
      .set("Idempotency-Key", randomUUID())
      .send({ amount: 500, category: "Luz", method: "Efectivo" })
      .expect(201);
    return customer.body.id as string;
  }

  it("rejects unauthenticated reset", async () => {
    await api().delete("/v1/business/data").expect(401);
  });

  it("wipes only the current business and keeps user + membership", async () => {
    const customerA = await seedBusinessData(authA(), "ProdA");
    await seedBusinessData(authB(), "ProdB");

    const res = await api().delete("/v1/business/data").set(authA()).expect(200);
    expect(res.body.deletedCustomerIds).toEqual([customerA]);
    expect(res.body.deleted.products).toBe(1);
    expect(res.body.deleted.customers).toBe(1);
    expect(res.body.deleted.expenses).toBe(1);

    expect(await prisma.product.count({ where: { businessId: bizA } })).toBe(0);
    expect(await prisma.customer.count({ where: { businessId: bizA } })).toBe(0);
    expect(await prisma.expense.count({ where: { businessId: bizA } })).toBe(0);
    expect(await prisma.product.count({ where: { businessId: bizB } })).toBe(1);
    expect(await prisma.customer.count({ where: { businessId: bizB } })).toBe(1);

    expect(await prisma.user.findUnique({ where: { id: userIdA } })).not.toBeNull();
    expect(
      await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: bizA, userId: userIdA } },
      }),
    ).not.toBeNull();
    expect(await prisma.business.findUnique({ where: { id: bizA } })).not.toBeNull();
  });

  it("a second reset is a harmless no-op", async () => {
    const res = await api().delete("/v1/business/data").set(authA()).expect(200);
    expect(res.body.deleted.products).toBe(0);
    expect(await prisma.product.count({ where: { businessId: bizB } })).toBe(1);
  });
});
