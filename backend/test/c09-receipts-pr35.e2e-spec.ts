import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import { Client } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

/**
 * C09-PR3.5 — credit/apply on a closed day is 409 CLOSED_DAY (same code and
 * message as reversals) and writes NOTHING: no DC-I-, no number consumed, no
 * allocation rows, no balance change. Checked under the business lock on
 * the arrival day (PR3.4), so a close that commits while the request waits
 * on the lock is honoured too. Fictitious data only.
 */
describe("C09-PR3.5 credit/apply on a closed day → 409 CLOSED_DAY, nothing written", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  type Db = { query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>; end(): Promise<void> };
  let locker: Db;

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    execSync(`${path.join(__dirname, "..", "node_modules", ".bin", "prisma")} migrate deploy`, {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env },
      stdio: "inherit",
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const u = new URL(pg.url);
    const c = new Client({ host: u.hostname, port: Number(u.port), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.slice(1) });
    await c.connect();
    locker = c as unknown as Db;
  }, 180000);

  afterAll(async () => {
    await locker?.end();
    await app?.close();
    pg?.stop();
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const api = () => request(app.getHttpServer());
  let seq = 0;

  async function setup() {
    seq += 1;
    const owner = await seedOwner(app, `c09r35-${seq}@test.co`, `Tienda Cierre ${seq}`);
    const auth = { Authorization: `Bearer ${owner.accessToken}`, "X-Business-Id": owner.business.id };
    const post = (url: string, body: object, key = randomUUID()) => api().post(url).set(auth).set("Idempotency-Key", key).send(body);
    const product = (await post("/v1/products", { name: "Bombón", price: 1000, stock: 100, avgCost: 400 })).body.id;
    const session = (await post("/v1/cash/sessions", { openingFloat: 0 })).body;
    const ana = (await post("/v1/customers", { name: "Ana Cierre" })).body;
    const pay0 = (await post(`/v1/customers/${ana.id}/payments`, { amount: 800, method: "Efectivo" })).body; // saldo a favor 800
    expect(pay0.number).toMatch(/^DC-P-/);
    expect((await post("/v1/sales", { lines: [{ productId: product, qty: 2, unitPrice: 1000 }], paymentKind: "credit", customerId: ana.id, amountReceived: 0 })).status).toBe(201);
    return { biz: owner.business.id, post, session, ana, pay0 };
  }

  /** Everything credit/apply could write, so «nothing written» is checked, not assumed. */
  async function footprint(biz: string, customerId: string) {
    const [seqs, receipts, allocs, customer, moves] = await Promise.all([
      prisma.businessSequence.findMany({ where: { businessId: biz }, orderBy: { kind: "asc" } }),
      prisma.receipt.count({ where: { businessId: biz } }),
      prisma.debtAllocation.count({ where: { businessId: biz } }),
      prisma.customer.findUniqueOrThrow({ where: { id: customerId }, select: { debt: true, creditBalance: true } }),
      prisma.cashMove.count({ where: { businessId: biz } }),
    ]);
    return JSON.stringify({ seqs: seqs.map((s) => [s.kind, String(s.next)]), receipts, allocs, debt: String(customer.debt), credit: String(customer.creditBalance), moves });
  }

  async function waiters(n: number) {
    for (let i = 0; i < 500; i++) {
      const w = await locker.query("SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
      if ((w.rows[0]!.n as number) >= n) return;
      await sleep(10);
    }
    throw new Error("request never waited on the business lock");
  }

  it("simple: D closed, then credit/apply → 409 CLOSED_DAY like a reversal; nothing written; a retry with the same key is still 409", async () => {
    const s = await setup();
    expect((await s.post(`/v1/cash/sessions/${s.session.id}/close`, { countedEfectivo: 800 })).status).toBe(201);
    const before = await footprint(s.biz, s.ana.id);
    const key = randomUUID();
    const r = await s.post(`/v1/customers/${s.ana.id}/credit/apply`, {}, key);
    expect(r.status).toBe(409);
    const rev = await s.post(`/v1/customers/${s.ana.id}/payments/${s.pay0.id}/reverse`, { reasonCode: "duplicado" });
    expect(rev.status).toBe(409);
    expect(r.body).toEqual(rev.body); // same shape, code and copy as reversals
    expect(r.body.error.code).toBe("CLOSED_DAY");
    expect(await footprint(s.biz, s.ana.id)).toBe(before);
    expect((await s.post(`/v1/customers/${s.ana.id}/credit/apply`, {}, key)).status).toBe(409);
    expect(await footprint(s.biz, s.ana.id)).toBe(before);
  });

  it("race: the close holds the lock, credit/apply arrives while D is open, waits and runs after the close → 409, nothing written", async () => {
    const s = await setup();
    const before = await footprint(s.biz, s.ana.id);
    if (!/^[0-9a-f-]{36}$/.test(s.biz)) throw new Error("unexpected business id");
    await locker.query(`SELECT pg_advisory_lock(hashtext('${s.biz}'))`);
    const close = s.post(`/v1/cash/sessions/${s.session.id}/close`, { countedEfectivo: 800 }).then((x) => x);
    await waiters(1);
    const apply = s.post(`/v1/customers/${s.ana.id}/credit/apply`, {}).then((x) => x);
    await waiters(2);
    await locker.query(`SELECT pg_advisory_unlock(hashtext('${s.biz}'))`);
    const c = await close;
    const r = await apply;
    expect(c.status).toBe(201);
    expect({ status: r.status, code: r.body?.error?.code }).toEqual({ status: 409, code: "CLOSED_DAY" });
    // The close added nothing credit/apply could have written either: the footprint is unchanged.
    expect(await footprint(s.biz, s.ana.id)).toBe(before);
  });

  it("control: with D open, credit/apply still works (DC-I-, 201)", async () => {
    const s = await setup();
    const r = await s.post(`/v1/customers/${s.ana.id}/credit/apply`, {});
    expect(r.status).toBe(201);
    expect(r.body.receipts[0].number).toMatch(/^DC-I-\d{6}$/);
  });
});
