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

describe("cash open advisory lock", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  let token = "";
  let otherToken = "";
  let biz = "";
  let otherBiz = "";

  beforeAll(async () => {
    if (process.env.E2E_DATABASE_URL) {
      process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    } else {
      pg = await startLocalPostgres();
      process.env.DATABASE_URL = pg.url;
    }
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    execSync("npx prisma migrate deploy", {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const owner = await seedOwner(app, "open-lock@test.co", "Open Lock");
    const other = await seedOwner(app, "open-lock-other@test.co", "Otro");
    token = owner.accessToken;
    biz = owner.business.id;
    otherToken = other.accessToken;
    otherBiz = other.business.id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  function open(access: string, business: string, requestId: string) {
    return request(app.getHttpServer())
      .post("/v1/cash/sessions")
      .set("Authorization", `Bearer ${access}`)
      .set("X-Business-Id", business)
      .set("Idempotency-Key", requestId)
      .send({ openingFloat: 10000 });
  }

  it("allows only one open session when two phones open the same business", async () => {
    const [a, b] = await Promise.all([
      open(token, biz, randomUUID()),
      open(token, biz, randomUUID()),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const rejected = a.status === 409 ? a : b;
    expect(rejected.body.error.code).toBe("PENDING_SESSION");
    const openCount = await prisma.cashSession.count({
      where: { businessId: biz, closedAt: null },
    });
    expect(openCount).toBe(1);
  });

  it("returns the same session on retry and rejects a different request id", async () => {
    const existing = await prisma.cashSession.findFirst({
      where: { businessId: biz, closedAt: null },
    });
    expect(existing?.requestId).toBeTruthy();
    const retry = await open(token, biz, existing!.requestId!);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(existing!.id);
    const other = await open(token, biz, randomUUID());
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe("PENDING_SESSION");
    const openCount = await prisma.cashSession.count({
      where: { businessId: biz, closedAt: null },
    });
    expect(openCount).toBe(1);
  });

  it("lets another business open its own session at the same time", async () => {
    const [mine, theirs] = await Promise.all([
      open(token, biz, randomUUID()),
      open(otherToken, otherBiz, randomUUID()),
    ]);
    expect(mine.status).toBe(409);
    expect(theirs.status).toBe(201);
    const otherOpen = await prisma.cashSession.count({
      where: { businessId: otherBiz, closedAt: null },
    });
    expect(otherOpen).toBe(1);
  });
});
