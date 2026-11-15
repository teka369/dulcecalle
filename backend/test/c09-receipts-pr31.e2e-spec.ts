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
 * C09-PR3.1 — C09-QA-01: `POST /v1/customers/:id/credit/apply` (saldo a
 * favor applied without a parent operation) emits its own `allocation`
 * receipt DC-I-NNNNNN (imputación, per-business sequence) in the same
 * transaction, so the per-customer before/after chain (I-C3) has no gap.
 * Replay emits nothing and consumes no number. Embedded Postgres,
 * fictitious data only.
 */
describe("C09-PR3.1 saldo a favor imputation receipt (DC-I-)", () => {
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
    const owner = await seedOwner(app, `c09r31-${seq}@test.co`, `Tienda ${seq}`);
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

  it("QA-01 (Tester case): abono 800 → fiada DC-000001 of 2000 → credit/apply → next abono: DC-I-000001 closes the I-C3 chain; replay and a failed apply emit nothing and consume no number", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    const p1 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 800, method: "Efectivo" });
    expect(p1.status).toBe(201);
    const s = await fiada(b, ana.id, 2000);
    expect(s.status).toBe(201);
    expect(kinds(s.body.receipts)).toEqual([["sale", "DC-000001"]]);
    expect((await receipt(b, s.body.receipts[0].id)).snapshot).toMatchObject({ debtAfter: "2000", creditAfter: "800" });

    const key = randomUUID();
    const before = await prisma.receipt.count({ where: { businessId: b.biz } });
    const ap = await post(b, `/v1/customers/${ana.id}/credit/apply`, {}, key);
    expect(ap.status).toBe(201);
    expect([ap.body.creditApplied, ap.body.debtAfter, ap.body.creditBalanceAfter]).toEqual([800, 1200, 0]);
    expect(kinds(ap.body.receipts ?? [])).toEqual([["allocation", "DC-I-000001"]]);
    const ref = ap.body.receipts[0] as Ref;
    expect(ref.verifyCode).toMatch(VERIFY);
    expect(await prisma.receipt.count({ where: { businessId: b.biz } })).toBe(before + 1);

    const r = await receipt(b, ref.id);
    expect(r).toMatchObject({ kind: "allocation", number: "DC-I-000001", customerId: ana.id, sourceType: "allocation", sourceId: key, status: "vigente" });
    expect(r.snapshot).toMatchObject({
      kind: "allocation",
      number: "DC-I-000001",
      occurredOn: bogotaToday(),
      customer: { id: ana.id, code: ana.code, name: "Ana" },
      internal: false,
      parent: null,
      debtBefore: "2000",
      debtAfter: "1200",
      creditBefore: "800",
      creditAfter: "0",
      toObligations: "800",
      creditUsed: "800",
      toCredit: "0",
      lines: [
        { targetType: "sale", saleId: s.body.id, saleNumber: "DC-000001", amount: "800", openBefore: "2000", openAfter: "1200" },
        { targetType: "credit", amount: "-800", openBefore: null, openAfter: null },
      ],
    });
    expect(sha(canon(r.snapshot))).toBe(r.contentHash);
    // Same transaction as the rows it describes (I-C1): same group id.
    expect(await prisma.debtAllocation.count({ where: { businessId: b.biz, groupId: key } })).toBe(2);

    // Replay: same receipts, nothing emitted, no number consumed.
    const again = await post(b, `/v1/customers/${ana.id}/credit/apply`, {}, key);
    expect(again.status).toBe(201);
    expect(again.body.receipts).toEqual(ap.body.receipts);
    expect(await prisma.receipt.count({ where: { businessId: b.biz } })).toBe(before + 1);
    expect(await imputationNext(b.biz)).toBe(2n);
    // A rejected apply (no saldo a favor left) rolls back: no receipt, no number.
    const none = await post(b, `/v1/customers/${ana.id}/credit/apply`, { amount: 100 });
    expect([none.status, none.body.error?.code]).toEqual([422, "CREDIT_INSUFFICIENT"]);
    expect(await prisma.receipt.count({ where: { businessId: b.biz } })).toBe(before + 1);
    expect(await imputationNext(b.biz)).toBe(2n);

    const p2 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 500, method: "Nequi" });
    expect(p2.status).toBe(201);
    expect((await receipt(b, p2.body.receipts[0].id)).snapshot).toMatchObject({ number: "DC-P-000002", debtBefore: "1200", debtAfter: "700", creditBefore: "0", creditAfter: "0" });

    const { pairs, gaps } = await chain(b, ana.id);
    expect(gaps).toEqual([]);
    expect(pairs.map((x) => x.number)).toEqual(["DC-P-000001", "DC-000001", "DC-I-000001", "DC-P-000002"]);

    // The next imputation of the business takes DC-I-000002 (no gap, I-C6).
    const beto = await customer(b, "Beto");
    await post(b, `/v1/customers/${beto.id}/payments`, { amount: 300, method: "Efectivo" });
    const sb = await fiada(b, beto.id, 1000);
    const ap2 = await post(b, `/v1/customers/${beto.id}/credit/apply`, { target: { mode: "sale", saleId: sb.body.id } });
    expect(ap2.status).toBe(201);
    expect(kinds(ap2.body.receipts)).toEqual([["allocation", "DC-I-000002"]]);
    expect((await chain(b, beto.id)).gaps).toEqual([]);
    // Owner list filter by kind sees it.
    const list = await get(b, `/v1/receipts?customerId=${ana.id}&kind=allocation`);
    expect(list.body.map((x: { number: string }) => x.number)).toContain("DC-I-000001");
  });

  it("per business: another business starts its own DC-I-000001; split over two sales lists one line per sale with before/after", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    await post(b, `/v1/customers/${ana.id}/payments`, { amount: 2500, method: "Efectivo" });
    const s1 = await fiada(b, ana.id, 2000);
    const s2 = await fiada(b, ana.id, 1000);
    const ap = await post(b, `/v1/customers/${ana.id}/credit/apply`, {});
    expect(ap.status).toBe(201);
    expect(kinds(ap.body.receipts)).toEqual([["allocation", "DC-I-000001"]]);
    const r = await receipt(b, ap.body.receipts[0].id);
    expect(r.snapshot).toMatchObject({
      debtBefore: "3000",
      debtAfter: "500",
      creditBefore: "2500",
      creditAfter: "0",
      lines: [
        { targetType: "sale", saleId: s1.body.id, saleNumber: "DC-000001", amount: "2000", openBefore: "2000", openAfter: "0" },
        { targetType: "sale", saleId: s2.body.id, saleNumber: "DC-000002", amount: "500", openBefore: "1000", openAfter: "500" },
        { targetType: "credit", amount: "-2500" },
      ],
    });
    expect((await chain(b, ana.id)).gaps).toEqual([]);
  });
});
