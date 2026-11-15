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
import { occurredOnKey } from "../src/shared/clock";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

/**
 * C09-PR3.4 — C09-INV-01: the business day (occurredOn) is the day the
 * request ARRIVED; only createdAt is taken after the business lock (BL-02).
 * Fake clock (only `Date` is faked; timers, I/O and Postgres are real): the
 * request arrives at 23:59:59.900 COT, a second connection holds the
 * business advisory lock, the clock jumps past midnight, the lock is
 * released. abono, corregir (reversal + replacement abono), payment reversal,
 * sale void and credit/apply must keep occurredOn = D, with createdAt
 * post-lock (D+1) and no createdAt/number inversion. Fictitious data only.
 */
const TZ = "America/Bogota";
const NOT_DATE = [
  "hrtime", "nextTick", "performance", "queueMicrotask", "requestAnimationFrame", "cancelAnimationFrame",
  "requestIdleCallback", "cancelIdleCallback", "setImmediate", "clearImmediate", "setInterval", "clearInterval",
  "setTimeout", "clearTimeout",
] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("C09-PR3.4 midnight boundary: occurredOn = arrival day, createdAt post-lock (C09-INV-01)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  type Db = { query(text: string): Promise<{ rows: Array<Record<string, number>> }>; end(): Promise<void> };
  let locker: Db;

  // D = today's business day in Bogota (real clock), so JWTs and C03 bounds stay sane.
  const D = occurredOnKey(TZ, new Date());
  const D1 = new Date(new Date(`${D}T12:00:00.000-05:00`).getTime() + 86_400_000).toISOString().slice(0, 10);
  const arrival = new Date(`${D}T23:59:59.900-05:00`);
  let jumps = 0;

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
    jest.useFakeTimers({ doNotFake: [...NOT_DATE], now: new Date(`${D}T23:50:00.000-05:00`), advanceTimers: true });
  }, 180000);

  afterAll(async () => {
    jest.useRealTimers();
    await locker?.end();
    await app?.close();
    pg?.stop();
  });

  type Biz = { token: string; biz: string; productId: string };
  const api = () => request(app.getHttpServer());
  const auth = (b: Biz) => ({ Authorization: `Bearer ${b.token}`, "X-Business-Id": b.biz });
  const post = (b: Biz, url: string, body: object, key: string = randomUUID()) => api().post(url).set(auth(b)).set("Idempotency-Key", key).send(body);
  const fiada = (b: Biz, customerId: string, total: number) =>
    post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: total / 1000, unitPrice: 1000 }], paymentKind: "credit", customerId, amountReceived: 0 });
  const abono = (b: Biz, customerId: string, amount: number) => post(b, `/v1/customers/${customerId}/payments`, { amount, method: "Efectivo" });
  const key = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

  /**
   * Sends the request at 23:59:59.900 COT of D while another connection holds
   * the business lock; once the request waits on the lock the clock jumps
   * past midnight and the lock is released. Returns the response and the
   * post-midnight instant every createdAt must be at or after.
   */
  async function acrossMidnight(b: Biz, send: () => request.Test) {
    jumps += 1;
    jest.setSystemTime(arrival);
    if (!/^[0-9a-f-]{36}$/.test(b.biz)) throw new Error("unexpected business id");
    await locker.query(`SELECT pg_advisory_lock(hashtext('${b.biz}'))`);
    const pending = send().then((r) => r);
    for (let i = 0; ; i++) {
      const w = await locker.query("SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
      if (w.rows[0]!.n! > 0) break;
      if (i > 400) throw new Error("request never waited on the business lock");
      await sleep(10);
    }
    const after = new Date(new Date(`${D1}T00:00:00.000-05:00`).getTime() + jumps * 1000);
    jest.setSystemTime(after);
    await locker.query(`SELECT pg_advisory_unlock(hashtext('${b.biz}'))`);
    return { res: await pending, after };
  }

  async function receipts(b: Biz, ids: string[]) {
    return prisma.receipt.findMany({ where: { businessId: b.biz, id: { in: ids } } });
  }

  it("abono, corregir, payment reversal, sale void and credit/apply crossing midnight stay on the arrival day", async () => {
    const owner = await seedOwner(app, "c09r34@test.co", "Tienda Medianoche");
    const b: Biz = { token: owner.accessToken, biz: owner.business.id, productId: "" };
    b.productId = (await post(b, "/v1/products", { name: "Bombón", price: 1000, stock: 1000, avgCost: 400 })).body.id;
    const session = await post(b, "/v1/cash/sessions", { openingFloat: 0 });
    expect(session.status).toBe(201);
    const ana = (await post(b, "/v1/customers", { name: "Ana Medianoche" })).body;
    const beto = (await post(b, "/v1/customers", { name: "Beto Medianoche" })).body;
    expect((await fiada(b, ana.id, 5000)).status).toBe(201);
    const toVoid = (await fiada(b, ana.id, 1000)).body;
    const p1 = (await abono(b, ana.id, 500)).body; // corrected across midnight
    const p2 = (await abono(b, ana.id, 300)).body; // reversed across midnight
    expect((await abono(b, beto.id, 800)).status).toBe(201); // saldo a favor
    expect((await fiada(b, beto.id, 1000)).status).toBe(201);

    const problems: string[] = [];
    const check = async (label: string, r: { res: request.Response; after: Date }, occurredOns: Array<Date | string>, receiptIds: string[]) => {
      if (r.res.status !== 201) {
        problems.push(`${label}: HTTP ${r.res.status} ${JSON.stringify(r.res.body?.error ?? r.res.body)}`);
        return;
      }
      for (const d of occurredOns) if (key(d) !== D) problems.push(`${label}: occurredOn ${key(d)} ≠ arrival day ${D}`);
      const rs = await receipts(b, receiptIds);
      if (rs.length === 0) problems.push(`${label}: no receipt`);
      for (const x of rs) {
        const snap = x.snapshot as Record<string, unknown>;
        if (snap.occurredOn !== D) problems.push(`${label}: ${x.number} snapshot occurredOn ${String(snap.occurredOn)} ≠ ${D}`);
        if (x.createdAt.getTime() < r.after.getTime()) problems.push(`${label}: ${x.number} createdAt ${x.createdAt.toISOString()} before the lock was released (${r.after.toISOString()})`);
      }
    };
    const ids = (res: request.Response) => ((res.body?.receipts ?? []) as Array<{ id: string }>).map((x) => x.id);

    // 1. Abono.
    const a1 = await acrossMidnight(b, () => abono(b, ana.id, 200));
    if (a1.res.status === 201) {
      const pay = await prisma.customerPayment.findUniqueOrThrow({ where: { id: a1.res.body.id } });
      const mv = await prisma.cashMove.findFirst({ where: { businessId: b.biz, kind: "debt_collect", refId: pay.id } });
      await check("abono", a1, [pay.occurredOn, ...(mv ? [mv.occurredOn] : [])], ids(a1.res));
      if (mv && mv.sessionId !== session.body.id) problems.push(`abono: cash move not in the arrival day's caja (session ${mv.sessionId}, pending ${mv.pendingForSessionId})`);
    } else await check("abono", a1, [], []);

    // 2. Corregir: reversal of p1 + replacement abono (same customer).
    const c = await acrossMidnight(b, () =>
      post(b, `/v1/customers/${ana.id}/payments/${p1.id}/correct`, {
        reasonCode: "monto_equivocado",
        replacement: { customerId: ana.id, amount: 400, method: "Efectivo", requestId: randomUUID() },
      }),
    );
    if (c.res.status === 201) {
      const rev = await prisma.reversal.findFirstOrThrow({ where: { businessId: b.biz, targetId: p1.id } });
      const rep = await prisma.customerPayment.findUniqueOrThrow({ where: { id: rev.replacementId! } });
      await check("corregir", c, [rev.occurredOn, rep.occurredOn], ids(c.res));
    } else await check("corregir", c, [], []);

    // 3. Reverse an abono.
    const rv = await acrossMidnight(b, () => post(b, `/v1/customers/${ana.id}/payments/${p2.id}/reverse`, { reasonCode: "duplicado" }));
    if (rv.res.status === 201) {
      const rev = await prisma.reversal.findFirstOrThrow({ where: { businessId: b.biz, targetId: p2.id } });
      await check("reverso", rv, [rev.occurredOn], ids(rv.res));
    } else await check("reverso", rv, [], []);

    // 4. Void a sale.
    const vd = await acrossMidnight(b, () => post(b, `/v1/sales/${toVoid.id}/void`, { reasonCode: "error_digitacion" }));
    if (vd.res.status === 201) {
      const rev = await prisma.reversal.findFirstOrThrow({ where: { businessId: b.biz, targetId: toVoid.id } });
      await check("anular venta", vd, [rev.occurredOn], ids(vd.res));
    } else await check("anular venta", vd, [], []);

    // 5. credit/apply (DC-I-).
    const ap = await acrossMidnight(b, () => post(b, `/v1/customers/${beto.id}/credit/apply`, {}));
    await check("credit/apply", ap, [], ids(ap.res));

    // No createdAt/number inversion in any sequence of the business.
    const all = await prisma.receipt.findMany({ where: { businessId: b.biz } });
    const bySeq = new Map<string, typeof all>();
    for (const r of all) {
      const m = /^(DC-(?:[A-Z]-)?)(\d{6})$/.exec(r.number);
      if (!m) continue;
      bySeq.set(m[1]!, [...(bySeq.get(m[1]!) ?? []), r]);
    }
    for (const [prefix, rs] of bySeq) {
      rs.sort((x, y) => x.number.localeCompare(y.number));
      for (let i = 1; i < rs.length; i++) {
        if (rs[i]!.createdAt.getTime() < rs[i - 1]!.createdAt.getTime()) problems.push(`${prefix}: ${rs[i]!.number} createdAt before ${rs[i - 1]!.number}`);
      }
    }
    expect(problems).toEqual([]);
  }, 120000);
});
