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

describe("C01 late abonos and closed-day policy", () => {
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

    const owner = await seedOwner(app, "c01@test.co", "C01");
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

  const post = (url: string, body: object, key: string = randomUUID()) =>
    api().post(url).set(auth()).set("Idempotency-Key", key).send(body);

  let productId = "";
  let ana = "";
  let sessionId = "";

  it("setup: product, customer with debt, caja open", async () => {
    productId = (await post("/v1/products", { name: "Bombón", price: 1000, stock: 50, avgCost: 400 })).body.id;
    ana = (await post("/v1/customers", { name: "Ana" })).body.id;
    expect((await post(`/v1/customers/${ana}/initial-debts`, { amount: 50_000 })).status).toBe(201);
    const s = await post("/v1/cash/sessions", { openingFloat: 0 });
    sessionId = s.body.id;
  });

  it("an abono with an occurredAt from another day goes to the open day and keeps its occurredAt", async () => {
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    const r = await post(`/v1/customers/${ana}/payments`, { amount: 1_000, method: "Efectivo", occurredAt: yesterday });
    expect(r.status).toBe(201);
    expect(r.body.occurredAt).toBe(yesterday);
    expect(r.body.needsReview).toBe(false);
    const move = await prisma.cashMove.findFirst({ where: { businessId: biz, refId: r.body.id } });
    expect(move?.sessionId).toBe(sessionId);
  });

  it("an occurredAt in the future is a validation error", async () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    const r = await post(`/v1/customers/${ana}/payments`, { amount: 1_000, method: "Efectivo", occurredAt: future });
    expect(r.status).toBe(400);
  });

  it("close stores the «Cerrar igual» mark (unresolved count and amount)", async () => {
    const r = await post(`/v1/cash/sessions/${sessionId}/close`, { countedEfectivo: 1_000, unresolvedCount: 2, unresolvedAmount: 9_500 });
    expect(r.status).toBe(201);
    expect(r.body.unresolvedCount).toBe(2);
    expect(r.body.unresolvedAmount).toBe(9_500);
  });

  it("DC-01: an abono after the day closed is accepted as «recibido sin aplicar / requiere revisión», never rejected", async () => {
    const before = await prisma.customer.findUniqueOrThrow({ where: { id: ana } });
    const r = await post(`/v1/customers/${ana}/payments`, { amount: 5_000, method: "Efectivo" });
    expect(r.status).toBe(201);
    expect(r.body.needsReview).toBe(true);
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: ana } });
    expect(after.debt).toBe(before.debt - 5_000n);
    const move = await prisma.cashMove.findFirstOrThrow({ where: { businessId: biz, refId: r.body.id } });
    expect(move.sessionId).toBeNull();
    expect(move.pendingForSessionId).toBeNull();
    expect(move.needsReview).toBe(true);
    const un = await api().get("/v1/cash/unassigned-moves").set(auth());
    const row = (un.body.data ?? un.body).find((m: { id: string }) => m.id === move.id);
    expect(row?.needsReview).toBe(true);
    // the closed session totals are untouched
    const closed = await prisma.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(closed.expectedEfectivo).toBe(1_000n);
  });

  it("assigning the late move to an open caja clears the review flag", async () => {
    const move = await prisma.cashMove.findFirstOrThrow({ where: { businessId: biz, needsReview: true } });
    const next = await prisma.cashSession.create({
      data: { id: randomUUID(), businessId: biz, localDate: new Date("2099-01-01T00:00:00.000Z"), openedAt: new Date(), openingFloat: 0n, requestId: randomUUID() },
    });
    const r = await post(`/v1/cash/moves/${move.id}/assign`, { sessionId: next.id });
    expect(r.status).toBeLessThan(300);
    const updated = await prisma.cashMove.findUniqueOrThrow({ where: { id: move.id } });
    expect(updated.sessionId).toBe(next.id);
    expect(updated.needsReview).toBe(false);
    await prisma.cashMove.update({ where: { id: move.id }, data: { sessionId: null } });
    await prisma.cashCarry.deleteMany({ where: { currentSessionId: next.id } });
    await prisma.cashSession.delete({ where: { id: next.id } });
  });

  it("DC-16: an initial debt on a closed day is still accepted (no cash) and serialized like other debt writes", async () => {
    const r = await post(`/v1/customers/${ana}/initial-debts`, { amount: 2_000 });
    expect(r.status).toBe(201);
  });

  it("a sale on a closed day is still 409 CLOSED_DAY (the client keeps it as «Rechazada»)", async () => {
    const r = await post("/v1/sales", { paymentKind: "paid", amountReceived: 1000, method: "Efectivo", lines: [{ productId, qty: 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CLOSED_DAY");
  });
});
