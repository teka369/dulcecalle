import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
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
 * C09-PR2 — receipts `sale`, `payment`, `return` (SPEC-C09 §2, §3.2, §8):
 * T4-T5, T7-T8, I-C1, I-C2, I-C3; insert-only; responses carry `receipts`.
 * Embedded Postgres, fictitious data only.
 */
describe("C09-PR2 receipts", () => {
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
    const owner = await seedOwner(app, `c09r-${seq}@test.co`, `Tienda ${seq}`);
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
  async function receipt(b: Biz, id: string) {
    const r = await get(b, `/v1/receipts/${id}`);
    expect(r.status).toBe(200);
    return r.body;
  }

  it("T4 / T8 / I-C2: fiada with customer → sale receipt DC-000001 with debt before/after; hash = sha256(canonical(snapshot)), stable", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    const s = await fiada(b, ana.id, 5000);
    expect(s.status).toBe(201);
    expect(s.body.receipts).toHaveLength(1);
    const ref = s.body.receipts[0];
    expect(ref).toMatchObject({ kind: "sale", number: "DC-000001" });
    expect(ref.verifyCode).toMatch(VERIFY);
    const r = await receipt(b, ref.id);
    expect(r).toMatchObject({ id: ref.id, kind: "sale", number: "DC-000001", customerId: ana.id, sourceType: "sale", sourceId: s.body.id, status: "vigente", prevReceiptId: null });
    expect(r.snapshot).toMatchObject({
      kind: "sale",
      number: "DC-000001",
      internal: false,
      customer: { id: ana.id, code: ana.code, name: "Ana" },
      total: "5000",
      credit: "5000",
      debtBefore: "0",
      debtAfter: "5000",
      creditApplied: "0",
      lines: [{ productName: "Bombón", qty: 5, unitPrice: "1000", lineTotal: "5000" }],
    });
    expect(r.snapshot.business.name).toBe(`Tienda ${seq}`);
    // Dates in America/Bogota with the zone in the string (T27 later relies on it).
    expect(r.snapshot.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-05:00$/);
    expect(r.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha(canon(r.snapshot))).toBe(r.contentHash);
    expect(r.hashPrefix).toBe(r.contentHash.slice(0, 8));
    const again = await receipt(b, ref.id);
    expect([again.contentHash, canon(again.snapshot)]).toEqual([r.contentHash, canon(r.snapshot)]);
  });

  it("T5: paid sale without customer → internal receipt (customerId null), visible to owner and staff; another business gets 404", async () => {
    const b = await newBiz();
    const s = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 2, unitPrice: 1000 }], paymentKind: "paid", amountReceived: 2000, method: "Nequi" });
    expect(s.status).toBe(201);
    const r = await receipt(b, s.body.receipts[0].id);
    expect(r.customerId).toBeNull();
    expect(r.snapshot).toMatchObject({ internal: true, customer: null, received: { method: "Nequi", amount: "2000" }, debtBefore: null, debtAfter: null });
    const list = await get(b, "/v1/receipts");
    expect(list.status).toBe(200);
    expect(list.body.map((x: { id: string }) => x.id)).toContain(r.id);
    const staffId = randomUUID();
    const email = `c09r-staff-${staffId}@test.co`;
    await prisma.user.create({ data: { id: staffId, email, passwordHash: await bcrypt.hash("password12", 12) } });
    await prisma.businessMembership.create({ data: { id: randomUUID(), businessId: b.biz, userId: staffId, role: "staff" } });
    const login = await api().post("/v1/auth/login").send({ email, password: "password12" });
    const staff = { token: login.body.accessToken as string, biz: b.biz };
    expect((await get(staff, `/v1/receipts/${r.id}`)).status).toBe(200);
    const other = await newBiz();
    expect((await get(other, `/v1/receipts/${r.id}`)).status).toBe(404);
    expect((await get(other, "/v1/receipts")).body.map((x: { id: string }) => x.id)).not.toContain(r.id);
  });

  it("T7 / I-C1: replays with the same key return the same receipt; exactly one per (kind, source) for sale, payment and return", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    const k = randomUUID();
    const s1 = await fiada(b, ana.id, 3000, k);
    const s2 = await fiada(b, ana.id, 3000, k);
    expect(s2.body.receipts).toEqual(s1.body.receipts);
    const pk = randomUUID();
    const p1 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 1000, method: "Efectivo" }, pk);
    const p2 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 1000, method: "Efectivo" }, pk);
    expect(p1.body.receipts).toEqual(p2.body.receipts);
    expect(p1.body.receipts[0]).toMatchObject({ kind: "payment", number: "DC-P-000001" });
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: s1.body.id }, include: { lines: true } });
    const rk = randomUUID();
    const body = { lines: [{ saleLineId: sale.lines[0]!.id, qty: 1 }] };
    const r1 = await post(b, `/v1/sales/${s1.body.id}/returns`, body, rk);
    const r2 = await post(b, `/v1/sales/${s1.body.id}/returns`, body, rk);
    expect(r1.status).toBe(201);
    expect(r1.body.receipts[0]).toMatchObject({ kind: "return", number: "DC-D-000001" });
    expect(r2.body.receipts).toEqual(r1.body.receipts);
    const counts = await prisma.receipt.groupBy({ by: ["kind", "sourceId"], where: { businessId: b.biz }, _count: { _all: true } });
    expect(counts.every((c) => c._count._all === 1)).toBe(true);
    expect(counts.map((c) => c.kind).sort()).toEqual(["payment", "return", "sale"]);
  });

  it("I-C3: payment and return receipts carry the real before/after; after of one = before of the next for the same customer", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    const s = await fiada(b, ana.id, 5000);
    const p = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 2000, method: "Nequi" });
    expect(p.status).toBe(201);
    const pr = await receipt(b, p.body.receipts[0].id);
    expect(pr.snapshot).toMatchObject({
      kind: "payment",
      number: "DC-P-000001",
      amount: "2000",
      method: "Nequi",
      evidenceRef: null,
      debtBefore: "5000",
      debtAfter: "3000",
      creditBefore: "0",
      creditAfter: "0",
      creditGenerated: "0",
    });
    expect(sha(canon(pr.snapshot))).toBe(pr.contentHash);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: s.body.id }, include: { lines: true } });
    // Return 4 of 5 units (4000): 3000 lowers the debt, 1000 goes to saldo a favor (decision 6).
    const ret = await post(b, `/v1/sales/${s.body.id}/returns`, { lines: [{ saleLineId: sale.lines[0]!.id, qty: 4 }], remainder: "credit" });
    expect(ret.status).toBe(201);
    const rr = await receipt(b, ret.body.receipts[0].id);
    expect(rr.snapshot).toMatchObject({
      kind: "return",
      number: "DC-D-000001",
      saleNumber: "DC-000001",
      value: "4000",
      debtReduced: "3000",
      refundAmount: "0",
      toCredit: "1000",
      debtBefore: "3000",
      debtAfter: "0",
      creditBefore: "0",
      creditAfter: "1000",
      lines: [{ productName: "Bombón", qty: 4, unitPrice: "1000", value: "4000" }],
    });
    // Overpay abono → saldo a favor generated.
    const p2 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 500, method: "Efectivo" });
    const pr2 = await receipt(b, p2.body.receipts[0].id);
    expect(pr2.snapshot).toMatchObject({ debtBefore: "0", debtAfter: "0", creditBefore: "1000", creditAfter: "1500", creditGenerated: "500" });
    const all = await prisma.receipt.findMany({ where: { businessId: b.biz, customerId: ana.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const snaps = all.map((r) => r.snapshot as Record<string, string | null>);
    for (let i = 1; i < snaps.length; i++) {
      expect([snaps[i]!.debtBefore, snaps[i]!.creditBefore ?? snaps[i - 1]!.creditAfter]).toEqual([snaps[i - 1]!.debtAfter, snaps[i - 1]!.creditAfter ?? snaps[i]!.creditBefore]);
    }
    // Owner filters.
    const byKind = await get(b, `/v1/receipts?customerId=${ana.id}&kind=payment`);
    expect(byKind.body.map((x: { number: string }) => x.number)).toEqual(["DC-P-000002", "DC-P-000001"]);
  });

  it("corregir: the replacement abono gets its own payment receipt (C07 integration)", async () => {
    const b = await newBiz();
    const ana = await customer(b, "Ana");
    const beto = await customer(b, "Beto");
    await fiada(b, ana.id, 4000);
    await fiada(b, beto.id, 4000);
    const p = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 2000, method: "Efectivo" });
    const c = await post(b, `/v1/customers/${ana.id}/payments/${p.body.id}/correct`, {
      reasonCode: "cliente_equivocado",
      replacement: { customerId: beto.id, amount: 2000, method: "Efectivo", requestId: randomUUID() },
    });
    expect(c.status).toBe(201);
    const ref = c.body.replacementPayment.receipts[0];
    expect(ref).toMatchObject({ kind: "payment", number: "DC-P-000002" });
    const r = await receipt(b, ref.id);
    expect(r.snapshot).toMatchObject({ customer: { id: beto.id }, debtBefore: "4000", debtAfter: "2000", replacesPaymentNumber: "DC-P-000001" });
    // The reversed original stays readable, derived «anulado» (never edited).
    const orig = await receipt(b, p.body.receipts[0].id);
    expect(orig.status).toBe("anulado");
    expect(sha(canon(orig.snapshot))).toBe(orig.contentHash);
  });

  it("insert-only: UPDATE and DELETE on receipts fail; the business wipe keeps them", async () => {
    const b = await newBiz();
    const s = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: 1000 }], paymentKind: "paid", amountReceived: 1000, method: "Efectivo" });
    const id = s.body.receipts[0].id as string;
    await expect(prisma.$executeRawUnsafe(`UPDATE receipts SET number = 'X' WHERE id = '${id}'::uuid`)).rejects.toThrow(/RECEIPTS_IMMUTABLE/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM receipts WHERE id = '${id}'::uuid`)).rejects.toThrow(/RECEIPTS_IMMUTABLE/);
    const before = await receipt(b, id);
    expect((await api().delete("/v1/business/data").set(auth(b))).status).toBe(200);
    const after = await receipt(b, id);
    expect([after.contentHash, after.number]).toEqual([before.contentHash, before.number]);
  });
});
