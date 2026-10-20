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

/** loop/v1 M5 on real Postgres: GET /cash/sessions paging + batched summaries. */
describe("GET /v1/cash/sessions (paged, batched)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  let token = "";
  let biz = "";
  const ids: string[] = [];

  beforeAll(async () => {
    if (process.env.E2E_DATABASE_URL) process.env.DATABASE_URL = process.env.E2E_DATABASE_URL;
    else {
      pg = await startLocalPostgres();
      process.env.DATABASE_URL = pg.url;
    }
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    execSync("npx prisma migrate deploy", { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "inherit" });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const owner = await seedOwner(app, "sessions-list@test.co", "Lista Cajas");
    token = owner.accessToken;
    biz = owner.business.id;
    for (let i = 0; i < 6; i++) {
      const id = randomUUID();
      ids.push(id);
      const open = i === 5;
      await prisma.cashSession.create({
        data: {
          id, businessId: biz, localDate: new Date(Date.UTC(2026, 0, 1 + i)), openedAt: new Date(Date.UTC(2026, 0, 1 + i, 12)),
          closedAt: open ? null : new Date(Date.UTC(2026, 0, 1 + i, 23)), openingFloat: 1000n,
          expectedEfectivo: open ? null : 1500n, expectedNequi: open ? null : 0n, closingCount: open ? null : 1500n, difference: open ? null : 0n,
          closeMode: open ? null : "counted",
        },
      });
      await prisma.cashMove.create({
        data: { id: randomUUID(), businessId: biz, amount: 500n, direction: "in", method: "Efectivo", kind: "aporte", sessionId: id, occurredOn: new Date(Date.UTC(2026, 0, 1 + i)) },
      });
    }
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const get = (qs = "") =>
    request(app.getHttpServer()).get(`/v1/cash/sessions${qs}`).set("Authorization", `Bearer ${token}`).set("X-Business-Id", biz);

  it("no params: same array shape as before, newest first, summaries computed", async () => {
    const res = await get().expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.map((r: { id: string }) => r.id)).toEqual([...ids].reverse());
    expect(res.body[0]).toMatchObject({ regularized: false, moveCount: 1, expectedEfectivo: 1500, canCountClose: true });
    expect(res.body[1]).toMatchObject({ regularized: true, moveCount: 1, hasLaterOpenSession: true });
  });

  it("limit + cursor walk the list without gaps/dupes; status filters still apply", async () => {
    const p1 = (await get("?limit=4").expect(200)).body as { id: string }[];
    const p2 = (await get(`?limit=4&cursor=${p1[3].id}`).expect(200)).body as { id: string }[];
    expect([...p1, ...p2].map((r) => r.id)).toEqual([...ids].reverse());
    expect((await get("?status=open").expect(200)).body).toHaveLength(1);
    expect((await get("?status=closed&limit=2").expect(200)).body).toHaveLength(2);
  });

  it("bad limit / cursor → 400", async () => {
    await get("?limit=abc").expect(400);
    await get("?limit=0").expect(400);
    await get("?cursor=nope").expect(400);
    await get(`?cursor=${randomUUID()}`).expect(400);
  });
});
