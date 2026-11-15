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


/**
 * C09-PR3.3 — C09-BL-02: every receipt-emitting path (sale, abono, return,
 * reversal, corregir, credit/apply) takes its timestamp AFTER the business
 * lock, so under concurrency createdAt order == number order == the
 * per-customer before/after chain (I-C3). Mixed parallel HTTP requests
 * against the e2e app on embedded Postgres; fictitious data only.
 */
describe("C09-PR3.3 mixed concurrency keeps I-C3 ordered (BL-02)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;

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
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  type Biz = { token: string; biz: string; productId: string };
  let seq = 0;
  async function newBiz(): Promise<Biz> {
    seq += 1;
    const owner = await seedOwner(app, `c09r33-${seq}@test.co`, `Tienda ${seq}`);
    const b: Biz = { token: owner.accessToken, biz: owner.business.id, productId: "" };
    const p = await post(b, "/v1/products", { name: "Bombón", price: 1000, stock: 10_000, avgCost: 400 });
    expect(p.status).toBe(201);
    b.productId = p.body.id;
    expect((await post(b, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    return b;
  }
  const api = () => request(app.getHttpServer());
  const auth = (b: { token: string; biz: string }) => ({ Authorization: `Bearer ${b.token}`, "X-Business-Id": b.biz });
  const post = (b: { token: string; biz: string }, url: string, body: object, key: string = randomUUID()) =>
    api().post(url).set(auth(b)).set("Idempotency-Key", key).send(body);
  async function customer(b: Biz, name = "Ana") {
    const r = await post(b, "/v1/customers", { name });
    expect(r.status).toBe(201);
    return r.body as { id: string; code: string };
  }
  const fiada = (b: Biz, customerId: string, total: number, key?: string) =>
    post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: total / 1000, unitPrice: 1000 }], paymentKind: "credit", customerId, amountReceived: 0 }, key);
  type Snap = Record<string, unknown>;
  type R = { id: string; kind: string; number: string; customerId: string | null; createdAt: Date; snapshot: Snap };
  const SEQ_PREFIX: Array<[string, RegExp]> = [
    ["sale", /^DC-(\d{6})$/],
    ["payment", /^DC-P-(\d{6})$/],
    ["reversal", /^DC-R-(\d{6})$/],
    ["return", /^DC-D-(\d{6})$/],
    ["imputation", /^DC-I-(\d{6})$/],
  ];
  const seqOf = (n: string) => {
    for (const [k, re] of SEQ_PREFIX) {
      const m = re.exec(n);
      if (m) return { kind: k, n: Number(m[1]) };
    }
    return null;
  };

  /**
   * Chain links of one customer in createdAt order. Receipts with the SAME
   * createdAt (same ms) are ordered by the chain itself (before = previous
   * after); any other order is reported as a problem.
   */
  function chainProblems(rows: R[]): string[] {
    const links = rows.filter((r) => r.snapshot.debtBefore != null).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const out: string[] = [];
    let prev: R | null = null;
    let i = 0;
    while (i < links.length) {
      let j = i;
      while (j < links.length && links[j]!.createdAt.getTime() === links[i]!.createdAt.getTime()) j++;
      const group = links.slice(i, j);
      while (group.length > 0) {
        const k: number = prev ? group.findIndex((g) => g.snapshot.debtBefore === prev!.snapshot.debtAfter && g.snapshot.creditBefore === prev!.snapshot.creditAfter) : 0;
        if (k < 0) {
          const g = group[0]!;
          out.push(`${prev!.number} closes ${String(prev!.snapshot.debtAfter)}/${String(prev!.snapshot.creditAfter)} but ${g.number} opens ${String(g.snapshot.debtBefore)}/${String(g.snapshot.creditBefore)}`);
          prev = group.shift()!;
        } else {
          prev = group.splice(k, 1)[0]!;
        }
      }
      i = j;
    }
    return out;
  }

  /** Per sequence (business-wide): numbers 1..N, no gaps/duplicates, and createdAt order never contradicts number order. */
  function sequenceProblems(rows: R[]): string[] {
    const out: string[] = [];
    const by = new Map<string, Array<{ n: number; t: number; number: string }>>();
    for (const r of rows) {
      const s = seqOf(r.number);
      if (!s) continue;
      const l = by.get(s.kind) ?? [];
      l.push({ n: s.n, t: r.createdAt.getTime(), number: r.number });
      by.set(s.kind, l);
    }
    for (const [k, l] of by) {
      l.sort((a, b) => a.n - b.n);
      l.forEach((x, idx) => {
        if (x.n !== idx + 1) out.push(`${k}: expected #${idx + 1}, got ${x.number}`);
      });
      for (let i = 1; i < l.length; i++) {
        if (l[i]!.t < l[i - 1]!.t) out.push(`${k}: ${l[i]!.number} createdAt ${new Date(l[i]!.t).toISOString()} is before ${l[i - 1]!.number} ${new Date(l[i - 1]!.t).toISOString()}`);
      }
    }
    return out;
  }

  it("mixed parallel sales, abonos, a return, a reversal, a corregir and a credit/apply for Ana (+ Beto): createdAt order == number order == I-C3 chain, no gaps, balances consistent", async () => {
    const b = await newBiz();
    const ana = await customer(b, "Ana");
    const beto = await customer(b, "Beto");
    // Setup (sequential): Ana fiada 10000 (DC-000001), abonos P0 1000 (to reverse) and P1 700 (to corregir → Beto).
    const s0 = await fiada(b, ana.id, 10000);
    const p0 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 1000, method: "Efectivo" });
    const p1 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 700, method: "Efectivo" });
    await fiada(b, beto.id, 5000);
    const cris = await customer(b, "Cris");
    await post(b, `/v1/customers/${cris.id}/payments`, { amount: 900, method: "Efectivo" }); // saldo a favor 900
    await fiada(b, cris.id, 3000);
    expect([s0.status, p0.status, p1.status]).toEqual([201, 201, 201]);
    const sale0 = await prisma.sale.findUniqueOrThrow({ where: { id: s0.body.id }, include: { lines: true } });

    const reqs: Array<Promise<request.Response>> = [];
    for (let i = 0; i < 4; i++) reqs.push(fiada(b, ana.id, 1000));
    for (let i = 0; i < 4; i++) reqs.push(post(b, `/v1/customers/${ana.id}/payments`, { amount: 500, method: i % 2 ? "Nequi" : "Efectivo" }));
    reqs.push(post(b, `/v1/sales/${s0.body.id}/returns`, { lines: [{ saleLineId: sale0.lines[0]!.id, qty: 1 }] }));
    reqs.push(post(b, `/v1/customers/${ana.id}/payments/${p0.body.id}/reverse`, { reasonCode: "duplicado" }));
    reqs.push(
      post(b, `/v1/customers/${ana.id}/payments/${p1.body.id}/correct`, {
        reasonCode: "cliente_equivocado",
        replacement: { customerId: beto.id, amount: 700, method: "Efectivo", requestId: randomUUID() },
      }),
    );
    for (let i = 0; i < 2; i++) reqs.push(fiada(b, beto.id, 1000));
    for (let i = 0; i < 2; i++) reqs.push(post(b, `/v1/customers/${beto.id}/payments`, { amount: 300, method: "Efectivo" }));
    reqs.push(post(b, `/v1/customers/${cris.id}/credit/apply`, {}));
    for (let i = 0; i < 2; i++) reqs.push(fiada(b, cris.id, 1000));
    const res = await Promise.all(reqs);
    expect(res.map((r) => r.status)).toEqual(res.map(() => 201));

    const rows = (await prisma.receipt.findMany({ where: { businessId: b.biz } })) as unknown as R[];
    const problems = [
      ...sequenceProblems(rows),
      ...[ana.id, beto.id, cris.id].flatMap((c) => chainProblems(rows.filter((r) => r.customerId === c)).map((p) => `[${c === ana.id ? "Ana" : c === beto.id ? "Beto" : "Cris"}] ${p}`)),
    ];
    expect(problems).toEqual([]);

    // Balances: deterministic finals, equal to the last chain link; never negative saldo a favor.
    // Ana: 10000 + 1000 (P0 reversed) + 700 (P1 corrected away) − 1700 + 4×1000 − 4×500 − 1000 (return) = 11000.
    // Beto: 5000 − 700 (replacement) + 2×1000 − 2×300 = 5700. Cris: 3000 − 900 + 2×1000 = 4100.
    for (const [id, debt, credit] of [[ana.id, 11000n, 0n], [beto.id, 5700n, 0n], [cris.id, 4100n, 0n]] as const) {
      const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
      expect([c.debt, c.creditBalance]).toEqual([debt, credit]);
      const last = rows
        .filter((r) => r.customerId === id && r.snapshot.debtBefore != null)
        .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime() || (x.number < y.number ? -1 : 1))
        .pop()!;
      expect([last.snapshot.debtAfter, last.snapshot.creditAfter]).toEqual([String(debt), String(credit)]);
    }
  });
});
