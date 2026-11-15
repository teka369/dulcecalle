import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { execSync } from "child_process";
import { createHash, randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

/** Independent canonical JSON (sorted keys, recursive) — the test does not reuse the server helper. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const VERIFY = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{10}$/;

/**
 * C09-PR3.2 — (1) a DC-I- imputation whose credit_apply rows are
 * compensated by a reversal reads «anulado» (fully) or stays «vigente»
 * (partially), always derived, with `related` → the DC-R-; (2) concurrent
 * credit/apply: no double consumption of saldo a favor, DC-I- without gaps
 * or duplicates. Embedded Postgres, fictitious data only.
 */
describe("C09-PR3.2 DC-I- status after reversal and credit/apply concurrency", () => {
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
    const owner = await seedOwner(app, `c09r32-${seq}@test.co`, `Tienda ${seq}`);
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
  const get = (b: { token: string; biz: string }, url: string) => api().get(url).set(auth(b));
  async function customer(b: Biz, name = "Ana") {
    const r = await post(b, "/v1/customers", { name });
    expect(r.status).toBe(201);
    return r.body as { id: string; code: string };
  }
  const fiada = (b: Biz, customerId: string, total: number, key?: string) =>
    post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: total / 1000, unitPrice: 1000 }], paymentKind: "credit", customerId, amountReceived: 0 }, key);
  const bogotaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
  async function receipt(b: Biz, id: string) {
    const r = await get(b, `/v1/receipts/${id}`);
    expect(r.status).toBe(200);
    return r.body;
  }


  type Ref = { id: string; kind: string; number: string; verifyCode: string };
  const kinds = (refs: Ref[]) => refs.map((r) => [r.kind, r.number]);

  type Snap = Record<string, unknown>;
  /** I-C3 — receipts that carry the customer's balances, in emission order; after of one = before of the next. */
  async function chain(b: Biz, customerId: string) {
    const all = await prisma.receipt.findMany({ where: { businessId: b.biz, customerId }, orderBy: [{ createdAt: "asc" }, { number: "asc" }] });
    const links = all.filter((r) => (r.snapshot as Snap).debtBefore != null);
    const pairs = links.map((r) => {
      const s = r.snapshot as Snap;
      return { number: r.number, debtBefore: s.debtBefore, debtAfter: s.debtAfter, creditBefore: s.creditBefore, creditAfter: s.creditAfter };
    });
    const gaps: string[] = [];
    for (let i = 1; i < pairs.length; i++) {
      const p = pairs[i - 1]!;
      const c = pairs[i]!;
      if (p.debtAfter !== c.debtBefore || p.creditAfter !== c.creditBefore) {
        gaps.push(`${p.number} closes ${String(p.debtAfter)}/${String(p.creditAfter)} but ${c.number} opens ${String(c.debtBefore)}/${String(c.creditBefore)}`);
      }
    }
    return { pairs, gaps };
  }
  const imputationNext = async (biz: string) =>
    (await prisma.$queryRaw<Array<{ next: bigint }>>`SELECT next FROM business_sequences WHERE business_id = ${biz}::uuid AND kind::text = 'imputation'`)[0]?.next ?? null;

  type Rel = { id: string; kind: string; number: string };
  const relNumbers = (x: { related: Rel[] }) => x.related.map((r) => r.number).sort();

  it("(1) full: abono 800 → fiada DC-000001 → credit/apply DC-I-000001 → reverse the abono → DC-I- «anulado» (derived, hash unchanged) with related DC-R-; owner+portal list/detail agree; I-C3 coherent", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    const p = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 800, method: "Efectivo" });
    expect(p.status).toBe(201);
    const s = await fiada(b, ana.id, 2000);
    expect(s.status).toBe(201);
    const ap = await post(b, `/v1/customers/${ana.id}/credit/apply`, {});
    expect(kinds(ap.body.receipts)).toEqual([["allocation", "DC-I-000001"]]);
    const iRef = ap.body.receipts[0] as Ref;
    const iBefore = await receipt(b, iRef.id);
    expect(iBefore.status).toBe("vigente");

    const rv = await post(b, `/v1/customers/${ana.id}/payments/${p.body.id}/reverse`, { reasonCode: "duplicado" });
    expect(rv.status).toBe(201);
    expect(kinds(rv.body.receipts)).toEqual([["reversal", "DC-R-000001"], ["allocation", "DC-R-000001/D1"]]);
    const iAfter = await receipt(b, iRef.id);
    expect(iAfter.status).toBe("anulado");
    expect(relNumbers(iAfter)).toEqual(["DC-R-000001", "DC-R-000001/D1"]);
    // Derived, never edited.
    expect(iAfter.contentHash).toBe(iBefore.contentHash);
    expect(iAfter.snapshot).toEqual(iBefore.snapshot);
    expect(sha(canon(iAfter.snapshot))).toBe(iAfter.contentHash);
    expect(iRef.verifyCode).toMatch(VERIFY);
    expect(iAfter.snapshot.occurredOn).toBe(bogotaToday());
    // Owner list agrees with the detail.
    const list = await get(b, `/v1/receipts?customerId=${ana.id}&kind=allocation`);
    expect(list.body.find((x: { id: string }) => x.id === iRef.id).status).toBe("anulado");
    // Portal (customer token) list + detail use the same derivation.
    expect((await post(b, `/v1/customers/${ana.id}/pin`, { pin: "482913" })).status).toBeLessThan(300);
    const login = await api().post("/v1/customer-access/login").send({ code: ana.code, pin: "482913", businessId: b.biz });
    expect(login.status).toBe(201);
    const ct = { Authorization: `Bearer ${login.body.accessToken}` };
    const pl = await api().get("/v1/customer/me/receipts").set(ct);
    expect(pl.status).toBe(200);
    expect(pl.body.find((x: { id: string }) => x.id === iRef.id).status).toBe("anulado");
    const pd = await api().get(`/v1/customer/me/receipts/${iRef.id}`).set(ct);
    expect(pd.status).toBe(200);
    expect([pd.body.status, relNumbers(pd.body)]).toEqual(["anulado", ["DC-R-000001", "DC-R-000001/D1"]]);

    // I-C3: DC-P-000001 → DC-000001 → DC-I-000001 → DC-R-000001, no gaps.
    const { pairs, gaps } = await chain(b, ana.id);
    expect(gaps).toEqual([]);
    expect(pairs.map((x) => x.number)).toEqual(["DC-P-000001", "DC-000001", "DC-I-000001", "DC-R-000001"]);
    expect(pairs[3]).toMatchObject({ debtBefore: "1200", debtAfter: "2000", creditBefore: "0", creditAfter: "0" });
  });

  it("(1) partial: saldo a favor 3000 → fiada 4000 → DC-I-000001 (3000) → return 3 units → void the sale: only 1000 of the 3000 is compensated → DC-I- stays «vigente» with related DC-R-", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    await post(b, `/v1/customers/${ana.id}/payments`, { amount: 3000, method: "Efectivo" });
    const s = await fiada(b, ana.id, 4000);
    const ap = await post(b, `/v1/customers/${ana.id}/credit/apply`, {});
    expect([ap.status, ap.body.creditApplied]).toEqual([201, 3000]);
    const iRef = ap.body.receipts[0] as Ref;
    expect(iRef.number).toBe("DC-I-000001");
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: s.body.id }, include: { lines: true } });
    const ret = await post(b, `/v1/sales/${s.body.id}/returns`, { lines: [{ saleLineId: sale.lines[0]!.id, qty: 3 }], remainder: "credit" });
    expect(ret.status).toBe(201);
    const v = await post(b, `/v1/sales/${s.body.id}/void`, { reasonCode: "error_digitacion" });
    expect(v.status).toBe(201);
    const rNum = (v.body.receipts as Ref[]).find((r) => r.kind === "reversal")!.number;
    // The void released 1000 of the money DC-I-000001 put on the sale (the rest was already returned).
    const rel = await prisma.debtAllocation.findMany({ where: { businessId: b.biz, sourceType: "reversal", saleId: s.body.id, amount: { lt: 0n } } });
    expect(rel.reduce((a, r) => a + r.amount, 0n)).toBe(-1000n);
    const i = await receipt(b, iRef.id);
    expect(i.status).toBe("vigente");
    expect(i.related.map((r: Rel) => r.number)).toContain(rNum);
    expect((await chain(b, ana.id)).gaps).toEqual([]);
  });

  it("(2) concurrency: 8 parallel applies of 300 for Ana (saldo 1000) + 4 for Beto (saldo 500) → no double consumption, DC-I- 000001..k without gaps/duplicates, one receipt per success, rejects emit nothing", async () => {
    const b = await newBiz();
    const ana = await customer(b, "Ana");
    const beto = await customer(b, "Beto");
    await post(b, `/v1/customers/${ana.id}/payments`, { amount: 1000, method: "Efectivo" });
    await post(b, `/v1/customers/${beto.id}/payments`, { amount: 500, method: "Efectivo" });
    await fiada(b, ana.id, 5000);
    await fiada(b, beto.id, 5000);
    const receiptsBefore = await prisma.receipt.count({ where: { businessId: b.biz } });
    const calls = [
      ...Array.from({ length: 8 }, () => ({ c: ana.id, p: post(b, `/v1/customers/${ana.id}/credit/apply`, { amount: 300 }) })),
      ...Array.from({ length: 4 }, () => ({ c: beto.id, p: post(b, `/v1/customers/${beto.id}/credit/apply`, { amount: 300 }) })),
    ];
    const res = await Promise.all(calls.map(async (x) => ({ c: x.c, r: await x.p })));
    const ok = res.filter((x) => x.r.status === 201);
    const bad = res.filter((x) => x.r.status !== 201);
    expect(bad.every((x) => x.r.status === 422 && x.r.body.error?.code === "CREDIT_INSUFFICIENT")).toBe(true);
    const okAna = ok.filter((x) => x.c === ana.id).length;
    const okBeto = ok.filter((x) => x.c === beto.id).length;
    // Serialized: exactly floor(saldo / 300) succeed — never more (no double consumption).
    expect([okAna, okBeto]).toEqual([3, 1]);
    for (const [id, n, saldo] of [[ana.id, okAna, 1000], [beto.id, okBeto, 500]] as const) {
      const c = await prisma.customer.findUniqueOrThrow({ where: { id } });
      expect(c.creditBalance).toBe(BigInt(saldo - 300 * n));
      expect(c.creditBalance >= 0n).toBe(true);
      expect(c.debt).toBe(BigInt(5000 - 300 * n));
      const used = await prisma.debtAllocation.aggregate({ where: { businessId: b.biz, customerId: id, mode: "credit_apply", targetType: "credit" }, _sum: { amount: true } });
      expect(used._sum.amount).toBe(BigInt(-300 * n));
      expect((await chain(b, id)).gaps).toEqual([]);
    }
    // One receipt per success; rejects emit nothing.
    expect(ok.every((x) => x.r.body.receipts?.length === 1)).toBe(true);
    expect(await prisma.receipt.count({ where: { businessId: b.biz } })).toBe(receiptsBefore + ok.length);
    const nums = ok.map((x) => (x.r.body.receipts[0] as Ref).number).sort();
    expect(nums).toEqual(Array.from({ length: ok.length }, (_, i) => `DC-I-${String(i + 1).padStart(6, "0")}`));
    expect(new Set(nums).size).toBe(nums.length);
    expect(await imputationNext(b.biz)).toBe(BigInt(ok.length + 1));
  });
});
