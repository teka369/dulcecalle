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

describe("C01.1 server trace, ledger occurredAt and review flag", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  let token = "";
  let biz = "";
  let tokenB = "";
  let bizB = "";

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

    const owner = await seedOwner(app, "c011@test.co", "C011");
    token = owner.accessToken;
    biz = owner.business.id;
    const other = await seedOwner(app, "c011b@test.co", "C011B");
    tokenB = other.accessToken;
    bizB = other.business.id;
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
  const ev = (over: object = {}) => ({
    operationId: randomUUID(),
    entity: "customerPayment",
    operation: "pay",
    kind: "rejected",
    amount: 20000,
    rejectionCode: "CLOSED_DAY",
    lastError: "No se puede editar el día.",
    deviceCreatedAt: new Date().toISOString(),
    ...over,
  });

  it("client-events: needs auth", async () => {
    await api().post("/v1/audit/client-events").send(ev()).expect(401);
  });

  it("client-events: idempotent per (operationId, kind); a discard of the same op is a second row", async () => {
    const e = ev();
    const a = await api().post("/v1/audit/client-events").set(auth()).send(e);
    expect(a.status).toBe(201);
    const b = await api().post("/v1/audit/client-events").set(auth()).send({ ...e, lastError: "otro" });
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.lastError).toBe("No se puede editar el día.");
    const c = await api().post("/v1/audit/client-events").set(auth()).send({ ...e, kind: "discarded" });
    expect(c.status).toBe(201);
    expect(c.body.id).not.toBe(a.body.id);
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM client_op_events WHERE business_id = $1::uuid AND operation_id = $2::uuid`,
      biz,
      e.operationId,
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  it("client-events: rejects unknown kinds and fields", async () => {
    await api().post("/v1/audit/client-events").set(auth()).send(ev({ kind: "deleted" })).expect(400);
    await api().post("/v1/audit/client-events").set(auth()).send(ev({ extra: 1 })).expect(400);
  });

  it("client-events: list is scoped to the business (another owner sees none of them)", async () => {
    const mine = await api().get("/v1/audit/client-events").set(auth());
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThanOrEqual(2);
    const theirs = await api().get("/v1/audit/client-events").set({ Authorization: `Bearer ${tokenB}`, "X-Business-Id": bizB });
    expect(theirs.status).toBe(200);
    expect(theirs.body).toEqual([]);
    const cross = await api().get("/v1/audit/client-events").set({ Authorization: `Bearer ${tokenB}`, "X-Business-Id": biz });
    expect([403, 404]).toContain(cross.status);
  });

  let ana = "";
  it("ledger: payments carry occurredAt and the caja day they entered", async () => {
    ana = (await post("/v1/customers", { name: "Ana" })).body.id;
    await post(`/v1/customers/${ana}/initial-debts`, { amount: 50_000 });
    const s = await post("/v1/cash/sessions", { openingFloat: 0 });
    expect(s.status).toBe(201);
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    const pay = await post(`/v1/customers/${ana}/payments`, { amount: 1000, method: "Efectivo", occurredAt: yesterday });
    expect(pay.status).toBe(201);
    const ledger = await api().get(`/v1/customers/${ana}/ledger`).set(auth());
    const p = ledger.body.payments.find((x: { id: string }) => x.id === pay.body.id);
    expect(new Date(p.occurredAt).toISOString()).toBe(yesterday);
    expect(p.cajaDay).toBe(s.body.localDate);
  });

  it("INV-01: assigning an unassigned abono move clears customer_payments.needs_review", async () => {
    const today = (await api().get("/v1/cash/today").set(auth())).body;
    await post(`/v1/cash/sessions/${today.session.id}/close`, { countedEfectivo: today.expected.efectivo });
    const pay = await post(`/v1/customers/${ana}/payments`, { amount: 1000, method: "Efectivo" });
    expect(pay.body.needsReview).toBe(true);
    const move = await prisma.cashMove.findFirstOrThrow({ where: { businessId: biz, refId: pay.body.id } });
    // A new caja for the next day is not possible in-test; assign to a fresh open session row.
    const open = await prisma.cashSession.create({
      data: { id: randomUUID(), businessId: biz, localDate: new Date("2099-01-01"), openingFloat: 0n, openedAt: new Date(), requestId: randomUUID() },
    });
    const r = await post(`/v1/cash/moves/${move.id}/assign`, { sessionId: open.id });
    expect([200, 201]).toContain(r.status);
    const row = await prisma.customerPayment.findUniqueOrThrow({ where: { id: pay.body.id } });
    expect(row.needsReview).toBe(false);
  });
});
