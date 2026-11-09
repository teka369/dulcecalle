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
import { assertSafeTarget, runBackfill } from "../ops/backfill-allocations";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

/**
 * C04-PR7 / T24 — backfill on embedded Postgres with FICTITIOUS data only.
 * Pre-C04 history is simulated by writing through the API and then deleting
 * the debt_allocations rows (customers.debt stays as the old server left it).
 * 5 customers: FIFO abonos, return (own sale + FIFO), initial debt + sale,
 * a legacy DEBT_MISMATCH, and one already allocated live by C04.
 */
describe("C04 backfill-allocations (T24, I-A8)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    execSync("npx prisma migrate deploy", { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "inherit" });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    prisma = app.get(PrismaService);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());
  type B = { token: string; biz: string; productId: string };
  const auth = (b: B) => ({ Authorization: `Bearer ${b.token}`, "X-Business-Id": b.biz });
  const post = (b: B, url: string, body: object) => api().post(url).set(auth(b)).set("Idempotency-Key", randomUUID()).send(body);
  const tick = () => new Promise((r) => setTimeout(r, 5));

  async function customer(b: B, name: string) {
    const r = await post(b, "/v1/customers", { name });
    expect(r.status).toBe(201);
    return r.body.id as string;
  }
  async function fiada(b: B, customerId: string, total: number) {
    await tick();
    const r = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: total }], paymentKind: "credit", customerId, amountReceived: 0 });
    expect(r.status).toBe(201);
    return { id: r.body.id as string, lineId: r.body.lines[0].id as string };
  }
  async function pay(b: B, customerId: string, amount: number) {
    await tick();
    expect((await post(b, `/v1/customers/${customerId}/payments`, { amount, method: "Efectivo" })).status).toBe(201);
  }

  async function snapshot(biz: string) {
    const rows = await prisma.debtAllocation.findMany({ where: { businessId: biz }, orderBy: [{ sourceId: "asc" }, { createdAt: "asc" }] });
    return rows.map((r) => [r.customerId, r.sourceType, r.sourceId, r.targetType, r.saleId, r.initialDebtId, r.amount.toString(), r.mode].join("|")).sort();
  }

  it("refuses a production-looking DATABASE_URL without approval", () => {
    expect(() => assertSafeTarget("postgres://u:p@ep-x.us-east-2.aws.neon.tech/db", {})).toThrow(/BACKFILL_PROD_APPROVED/);
    expect(() => assertSafeTarget("postgres://u:p@localhost:5432/db", {})).not.toThrow();
  });

  it("T24: dry-run, apply, second apply writes 0; mismatch reported with no writes; I-A3 holds", async () => {
    const owner = await seedOwner(app, "c04-backfill@test.co", "C04-BF");
    const b: B = { token: owner.accessToken, biz: owner.business.id, productId: "" };
    const p = await post(b, "/v1/products", { name: "Bombón", price: 1000, stock: 10_000, avgCost: 100 });
    b.productId = p.body.id;
    expect((await post(b, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);

    // 1) FIFO abonos over two sales.
    const c1 = await customer(b, "Uno");
    const s1a = await fiada(b, c1, 1000);
    const s1b = await fiada(b, c1, 2000);
    await pay(b, c1, 1500);
    // 2) Return: own sale first, then FIFO (older sale).
    const c2 = await customer(b, "Dos");
    const s2a = await fiada(b, c2, 3000);
    const s2b = await fiada(b, c2, 1000);
    await tick();
    const ret = await post(b, `/v1/sales/${s2b.id}/returns`, { lines: [{ saleLineId: s2b.lineId, qty: 1 }], remainder: "refund" });
    expect(ret.status).toBe(201);
    // 3) Initial debt + sale + abono.
    const c3 = await customer(b, "Tres");
    await tick();
    const d3 = await post(b, `/v1/customers/${c3}/initial-debts`, { amount: 500 });
    expect(d3.status).toBe(201);
    const s3 = await fiada(b, c3, 2000);
    await pay(b, c3, 1000);
    // 4) Legacy mismatch (importer DC-19 style).
    const c4 = await customer(b, "Cuatro");
    await fiada(b, c4, 1000);
    await pay(b, c4, 400);
    // 5) Allocated live by C04 (kept as is).
    const c5 = await customer(b, "Cinco");
    await fiada(b, c5, 1000);
    await pay(b, c5, 300);

    const live5 = await prisma.debtAllocation.count({ where: { customerId: c5 } });
    expect(live5).toBeGreaterThan(0);
    // Simulate pre-C04 history for customers 1–4.
    await prisma.debtAllocation.deleteMany({ where: { customerId: { in: [c1, c2, c3, c4] } } });
    await prisma.$executeRaw`UPDATE customers SET debt = debt + 700 WHERE id = ${c4}::uuid`;
    const debtsBefore = await prisma.customer.findMany({ where: { businessId: b.biz }, select: { id: true, debt: true, creditBalance: true } });

    const dry = await runBackfill(prisma, { apply: false, businessId: b.biz });
    expect(dry.rowsWritten).toBe(0);
    expect(await prisma.debtAllocation.count({ where: { customerId: { in: [c1, c2, c3, c4] } } })).toBe(0);
    expect(dry.mismatches).toBe(1);
    const mm = dry.customers.find((c) => c.customerId === c4)!;
    expect(mm).toMatchObject({ status: "DEBT_MISMATCH", storedDebt: 1300n, reconstructedDebt: 600n });

    const r1 = await runBackfill(prisma, { apply: true, businessId: b.biz });
    expect(r1.rowsWritten).toBe(dry.rowsPlanned - mm.planned.length);
    expect(r1.customers.find((c) => c.customerId === c4)!.written).toBe(0);
    expect(r1.customers.find((c) => c.customerId === c5)!.written).toBe(0);
    expect(await prisma.debtAllocation.count({ where: { customerId: c4 } })).toBe(0);
    expect(await prisma.debtAllocation.count({ where: { customerId: c5 } })).toBe(live5);
    // Same rows the dry-run planned.
    for (const c of dry.customers.filter((x) => x.status === "ok")) {
      const applied = r1.customers.find((x) => x.customerId === c.customerId)!;
      expect(applied.planned.map((x) => [x.sourceId, x.targetId, x.amount])).toEqual(c.planned.map((x) => [x.sourceId, x.targetId, x.amount]));
    }

    // Expected distributions.
    const rowsOf = async (cid: string) =>
      (await prisma.debtAllocation.findMany({ where: { customerId: cid }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((r) => [
        r.targetType,
        r.saleId ?? r.initialDebtId,
        Number(r.amount),
        r.mode,
        r.createdBy,
      ]);
    expect(await rowsOf(c1)).toEqual([
      ["sale", s1a.id, 1000, "backfill", null],
      ["sale", s1b.id, 500, "backfill", null],
    ]);
    expect(await rowsOf(c2)).toEqual([
      ["sale", s2b.id, 1000, "backfill", null],
    ]);
    expect(await rowsOf(c3)).toEqual([
      ["initial_debt", d3.body.id, 500, "backfill", null],
      ["sale", s3.id, 500, "backfill", null],
    ]);
    void s2a;

    const snap1 = await snapshot(b.biz);
    const r2 = await runBackfill(prisma, { apply: true, businessId: b.biz });
    expect(r2.rowsWritten).toBe(0);
    expect(await snapshot(b.biz)).toEqual(snap1);
    expect(r2.mismatches).toBe(1);

    // Never touches customers.debt; no saldo a favor invented.
    const debtsAfter = await prisma.customer.findMany({ where: { businessId: b.biz }, select: { id: true, debt: true, creditBalance: true } });
    expect(debtsAfter.sort((x, y) => x.id.localeCompare(y.id))).toEqual(debtsBefore.sort((x, y) => x.id.localeCompare(y.id)));

    // §5 I-A3 SQL: 0 rows except the reported mismatch.
    const bad = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT c.id FROM customers c
      WHERE c.business_id = ${b.biz}::uuid AND c.debt <>
        (SELECT COALESCE(SUM(s.credit),0) FROM sales s WHERE s.customer_id = c.id)
      + (SELECT COALESCE(SUM(d.amount),0) FROM initial_debts d WHERE d.customer_id = c.id)
      - (SELECT COALESCE(SUM(a.amount),0) FROM debt_allocations a WHERE a.customer_id = c.id AND a.target_type <> 'credit')`;
    expect(bad.map((x) => x.id)).toEqual([c4]);
  });
});
