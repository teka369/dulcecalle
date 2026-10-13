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

  // Contract (API_CONTRACT: POST /v1/cash/sessions): a second open on the same
  // business day returns that day's session (201). PENDING_SESSION (409) is
  // only for an unclosed session from another day. The partial unique index
  // cash_sessions_one_open_per_business (business_id WHERE closed_at IS NULL)
  // is the DB backstop for one open session per business.
  async function shiftOpenToYesterday(business: string) {
    await prisma.$executeRaw`
      UPDATE cash_sessions SET local_date = local_date - 1
      WHERE business_id = ${business}::uuid AND closed_at IS NULL`;
  }

  it("two phones opening the same business on the same day get one session", async () => {
    const [a, b] = await Promise.all([
      open(token, biz, randomUUID()),
      open(token, biz, randomUUID()),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    const openCount = await prisma.cashSession.count({
      where: { businessId: biz, closedAt: null },
    });
    expect(openCount).toBe(1);
  });

  it("returns the same session on retry and on a new request id the same day", async () => {
    const existing = await prisma.cashSession.findFirstOrThrow({
      where: { businessId: biz, closedAt: null },
    });
    const retry = await open(token, biz, existing.requestId!);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(existing.id);
    const other = await open(token, biz, randomUUID());
    expect(other.status).toBe(201);
    expect(other.body.id).toBe(existing.id);
  });

  it("rejects concurrent opens with 409 while a previous day is still open", async () => {
    await shiftOpenToYesterday(biz);
    const [a, b] = await Promise.all([
      open(token, biz, randomUUID()),
      open(token, biz, randomUUID()),
    ]);
    expect([a.status, b.status]).toEqual([409, 409]);
    for (const res of [a, b]) {
      expect(res.body.error.code).toBe("PENDING_SESSION");
    }
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

  it("the partial unique index blocks a second open row even past the service", async () => {
    await expect(
      prisma.cashSession.create({
        data: {
          id: randomUUID(),
          businessId: otherBiz,
          localDate: new Date("2020-01-01T00:00:00.000Z"),
          openedAt: new Date(),
          openingFloat: 0n,
          requestId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'cash_sessions_one_open_per_business'`;
    expect(rows[0]?.indexdef).toMatch(/UNIQUE INDEX .*\(business_id\) WHERE \(closed_at IS NULL\)/);
  });
});
