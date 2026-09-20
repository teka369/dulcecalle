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

describe("Fase M6.0 customer/supplier idempotency", () => {
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

    const owner = await seedOwner(app, "m6@test.co", "M6");
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

  it("POST /customers without Idempotency-Key is VALIDATION", async () => {
    await api()
      .post("/v1/customers")
      .set(auth())
      .send({ name: "Sin clave" })
      .expect(400)
      .expect((r) => expect(r.body.error.code).toBe("VALIDATION"));
  });

  it("same customer requestId does not duplicate and keeps the server code", async () => {
    const key = randomUUID();
    const first = await api()
      .post("/v1/customers")
      .set(auth())
      .set("Idempotency-Key", key)
      .send({ name: "Rosa" })
      .expect(201);
    expect(first.body.code).toBe("DC-0001");
    expect(first.body.name).toBe("Rosa");

    const again = await api()
      .post("/v1/customers")
      .set(auth())
      .set("Idempotency-Key", key)
      .send({ name: "Rosa otra" })
      .expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.code).toBe("DC-0001");
    expect(again.body.name).toBe("Rosa");

    const count = await prisma.customer.count({ where: { businessId: biz } });
    expect(count).toBe(1);
  });

  it("a new customer requestId gets the next server code", async () => {
    const second = await api()
      .post("/v1/customers")
      .set(auth())
      .set("Idempotency-Key", randomUUID())
      .send({ name: "Beto" })
      .expect(201);
    expect(second.body.code).toBe("DC-0002");
  });

  it("same supplier requestId does not duplicate", async () => {
    const key = randomUUID();
    const first = await api()
      .post("/v1/suppliers")
      .set(auth())
      .set("Idempotency-Key", key)
      .send({ name: "Mayorista" })
      .expect(201);
    const again = await api()
      .post("/v1/suppliers")
      .set(auth())
      .set("Idempotency-Key", key)
      .send({ name: "Mayorista otro" })
      .expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.name).toBe("Mayorista");
    const count = await prisma.supplier.count({ where: { businessId: biz } });
    expect(count).toBe(1);
  });
});
