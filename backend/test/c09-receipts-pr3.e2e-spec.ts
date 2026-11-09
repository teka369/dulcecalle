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
 * C09-PR2 — receipts `sale`, `payment`, `return` (SPEC-C09 §2, §3.2, §8):
 * T4-T5, T7-T8, I-C1, I-C2, I-C3; insert-only; responses carry `receipts`.
 * Embedded Postgres, fictitious data only.
 */
describe("C09-PR3 allocation and reversal receipts", () => {
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
    const owner = await seedOwner(app, `c09r3-${seq}@test.co`, `Tienda ${seq}`);
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
  async function saleOf(b: Biz, id: string) {
    return prisma.sale.findUniqueOrThrow({ where: { id }, include: { lines: true } });
  }

  it("T6: FIFO abono over 2 sales → payment + allocation DC-P-000001/D1 linked; amounts and open before/after per sale; replay identical", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    const s1 = await fiada(b, ana.id, 3000);
    const s2 = await fiada(b, ana.id, 2000);
    const key = randomUUID();
    const p = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 4000, method: "Efectivo" }, key);
    expect(p.status).toBe(201);
    expect(kinds(p.body.receipts)).toEqual([["payment", "DC-P-000001"], ["allocation", "DC-P-000001/D1"]]);
    const [payRef, allocRef] = p.body.receipts as Ref[];
    expect(allocRef!.verifyCode).toMatch(VERIFY);
    const a = await receipt(b, allocRef!.id);
    expect(a).toMatchObject({ kind: "allocation", number: "DC-P-000001/D1", customerId: ana.id, sourceType: "allocation", sourceId: p.body.id, status: "vigente" });
    expect(a.snapshot).toMatchObject({
      kind: "allocation",
      number: "DC-P-000001/D1",
      internal: false,
      customer: { id: ana.id, name: "Ana" },
      parent: { receiptId: payRef!.id, kind: "payment", number: "DC-P-000001" },
      occurredOn: bogotaToday(),
      toObligations: "4000",
      toCredit: "0",
      creditUsed: "0",
      lines: [
        { targetType: "sale", saleId: s1.body.id, saleNumber: "DC-000001", amount: "3000", openBefore: "3000", openAfter: "0" },
        { targetType: "sale", saleId: s2.body.id, saleNumber: "DC-000002", amount: "1000", openBefore: "2000", openAfter: "1000" },
      ],
    });
    expect(a.snapshot.createdAt).toMatch(/-05:00$/);
    expect(sha(canon(a.snapshot))).toBe(a.contentHash);
    // Linked both ways (derived from the shared source, no edit of the payment receipt).
    expect(a.related).toEqual([{ id: payRef!.id, kind: "payment", number: "DC-P-000001" }]);
    expect((await receipt(b, payRef!.id)).related).toEqual([{ id: allocRef!.id, kind: "allocation", number: "DC-P-000001/D1" }]);
    const again = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 4000, method: "Efectivo" }, key);
    expect(again.body.receipts).toEqual(p.body.receipts);
    // Surplus to saldo a favor: credit line, no open balances.
    const p2 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 1500, method: "Nequi" });
    const a2 = await receipt(b, p2.body.receipts[1].id);
    expect(a2.snapshot).toMatchObject({
      number: "DC-P-000002/D1",
      toObligations: "1000",
      toCredit: "500",
      lines: [
        { targetType: "sale", saleNumber: "DC-000002", amount: "1000", openBefore: "1000", openAfter: "0" },
        { targetType: "credit", saleId: null, saleNumber: null, amount: "500", openBefore: null, openAfter: null },
      ],
    });
    const groups = await prisma.receipt.groupBy({ by: ["kind", "sourceId"], where: { businessId: b.biz }, _count: { _all: true } });
    expect(groups.every((g) => g._count._all === 1)).toBe(true);
  });

  it("credit_apply: a sale that uses saldo a favor gets an allocation annex of the sale (DC-000002/D1)", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    await fiada(b, ana.id, 1000);
    await post(b, `/v1/customers/${ana.id}/payments`, { amount: 1500, method: "Efectivo" }); // 500 saldo a favor
    const s = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 2, unitPrice: 1000 }], paymentKind: "credit", customerId: ana.id, amountReceived: 0, applyCredit: true });
    expect(s.status).toBe(201);
    expect(kinds(s.body.receipts)).toEqual([["sale", "DC-000002"], ["allocation", "DC-000002/D1"]]);
    const a = await receipt(b, s.body.receipts[1].id);
    expect(a.snapshot).toMatchObject({
      parent: { kind: "sale", number: "DC-000002" },
      toObligations: "500",
      creditUsed: "500",
      toCredit: "0",
      lines: [
        { targetType: "sale", saleNumber: "DC-000002", amount: "500", openBefore: "2000", openAfter: "1500" },
        { targetType: "credit", amount: "-500", openBefore: null, openAfter: null },
      ],
    });
    // A plain sale without credit use emits no allocation.
    const plain = await fiada(b, ana.id, 1000);
    expect(kinds(plain.body.receipts)).toEqual([["sale", "DC-000003"]]);
  });

  it("decision 6: a return imputed FIFO to another sale gets an allocation annex DC-D-000001/D1; T10 return of a paid sale to saldo a favor says saldo a favor $X", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    const debt = await fiada(b, ana.id, 2000);
    const paid = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: 1000 }], paymentKind: "paid", customerId: ana.id, amountReceived: 1000, method: "Efectivo" });
    const pl = (await saleOf(b, paid.body.id)).lines[0]!;
    const r = await post(b, `/v1/sales/${paid.body.id}/returns`, { lines: [{ saleLineId: pl.id, qty: 1 }] });
    expect(r.status).toBe(201);
    expect(kinds(r.body.receipts)).toEqual([["return", "DC-D-000001"], ["allocation", "DC-D-000001/D1"]]);
    const a = await receipt(b, r.body.receipts[1].id);
    expect(a.snapshot).toMatchObject({
      parent: { kind: "return", number: "DC-D-000001" },
      lines: [{ targetType: "sale", saleId: debt.body.id, saleNumber: "DC-000001", amount: "1000", openBefore: "2000", openAfter: "1000" }],
    });
    // T10 — paid sale, no other debts, seller chooses saldo a favor.
    const beto = await customer(b, "Beto");
    const paid2 = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 3, unitPrice: 1000 }], paymentKind: "paid", customerId: beto.id, amountReceived: 3000, method: "Nequi" });
    const pl2 = (await saleOf(b, paid2.body.id)).lines[0]!;
    const r2 = await post(b, `/v1/sales/${paid2.body.id}/returns`, { lines: [{ saleLineId: pl2.id, qty: 2 }], remainder: "credit" });
    expect(r2.status).toBe(201);
    const rr = await receipt(b, r2.body.receipts[0].id);
    expect(rr.snapshot).toMatchObject({ kind: "return", number: "DC-D-000002", toCredit: "2000", refundAmount: "0", creditBefore: "0", creditAfter: "2000" });
    const a2 = await receipt(b, r2.body.receipts[1].id);
    expect(a2.snapshot).toMatchObject({ number: "DC-D-000002/D1", toCredit: "2000", lines: [{ targetType: "credit", amount: "2000" }] });
  });

  it("T9: void a fiada → reversal receipt DC-R-000001 (+ allocation annex); the sale receipt becomes «anulado» by derivation, unedited", async () => {
    const b = await newBiz();
    const ana = await customer(b);
    const s = await fiada(b, ana.id, 3000);
    const saleRef = s.body.receipts[0] as Ref;
    const before = await prisma.receipt.findUniqueOrThrow({ where: { id: saleRef.id } });
    // dryRun emits nothing.
    const dry = await post(b, `/v1/sales/${s.body.id}/void?dryRun=true`, { reasonCode: "error_digitacion" });
    expect(dry.status).toBe(200);
    expect(await prisma.receipt.count({ where: { businessId: b.biz } })).toBe(1);
    const key = randomUUID();
    const v = await post(b, `/v1/sales/${s.body.id}/void`, { reasonCode: "error_digitacion" }, key);
    expect(v.status).toBe(201);
    expect(kinds(v.body.receipts)).toEqual([["reversal", "DC-R-000001"], ["allocation", "DC-R-000001/D1"]]);
    const rv = await receipt(b, v.body.receipts[0].id);
    expect(rv).toMatchObject({ kind: "reversal", sourceType: "reversal", sourceId: v.body.id, customerId: ana.id, status: "vigente", prevReceiptId: null });
    expect(rv.snapshot).toMatchObject({
      kind: "reversal",
      number: "DC-R-000001",
      internal: false,
      customer: { id: ana.id, name: "Ana" },
      original: { type: "sale", id: s.body.id, number: "DC-000001", receiptId: saleRef.id },
      reasonCode: "error_digitacion",
      debtBefore: "3000",
      debtAfter: "0",
      creditBefore: "0",
      creditAfter: "0",
      cashOut: null,
      stock: [{ productName: "Bombón", qty: 3 }],
      occurredOn: bogotaToday(),
    });
    expect(rv.snapshot).not.toHaveProperty("reasonText");
    expect(sha(canon(rv.snapshot))).toBe(rv.contentHash);
    const a = await receipt(b, v.body.receipts[1].id);
    expect(a.snapshot).toMatchObject({ parent: { kind: "reversal", number: "DC-R-000001" }, lines: [{ targetType: "sale", saleNumber: "DC-000001", openBefore: "3000", openAfter: "0" }] });
    const sr = await receipt(b, saleRef.id);
    expect(sr.status).toBe("anulado");
    const after = await prisma.receipt.findUniqueOrThrow({ where: { id: saleRef.id } });
    expect([after.contentHash, canon(after.snapshot)]).toEqual([before.contentHash, canon(before.snapshot)]);
    // Replay of the void returns the same receipts.
    const again = await post(b, `/v1/sales/${s.body.id}/void`, { reasonCode: "error_digitacion" }, key);
    expect(again.body.receipts).toEqual(v.body.receipts);
    // GET reversal detail carries them too.
    expect((await get(b, `/v1/reversals/${v.body.id}`)).body.receipts).toEqual(v.body.receipts);
  });

  it("T9 internal: void a cash sale without customer → internal reversal receipt (customerId null, cash out), no allocation", async () => {
    const b = await newBiz();
    const s = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 2, unitPrice: 1000 }], paymentKind: "paid", amountReceived: 2000, method: "Nequi" });
    const v = await post(b, `/v1/sales/${s.body.id}/void`, { reasonCode: "duplicado" });
    expect(v.status).toBe(201);
    expect(kinds(v.body.receipts)).toEqual([["reversal", "DC-R-000001"]]);
    const rv = await receipt(b, v.body.receipts[0].id);
    expect(rv.customerId).toBeNull();
    expect(rv.snapshot).toMatchObject({ internal: true, customer: null, debtBefore: null, debtAfter: null, cashOut: { method: "Nequi", amount: "2000" }, original: { type: "sale", number: "DC-000001" } });
  });

  it("reverse and corregir an abono: reversal receipt + allocation annex reopening the sale; payment and its allocation «anulado»; replacement gets payment + allocation", async () => {
    const b = await newBiz();
    const ana = await customer(b, "Ana");
    const beto = await customer(b, "Beto");
    await fiada(b, ana.id, 3000);
    await fiada(b, beto.id, 3000);
    const p1 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 1000, method: "Efectivo" });
    const p2 = await post(b, `/v1/customers/${ana.id}/payments`, { amount: 500, method: "Efectivo" });
    const rv = await post(b, `/v1/customers/${ana.id}/payments/${p2.body.id}/reverse`, { reasonCode: "duplicado" });
    expect(rv.status).toBe(201);
    expect(kinds(rv.body.receipts)).toEqual([["reversal", "DC-R-000001"], ["allocation", "DC-R-000001/D1"]]);
    const r = await receipt(b, rv.body.receipts[0].id);
    expect(r.snapshot).toMatchObject({
      original: { type: "customer_payment", id: p2.body.id, number: "DC-P-000002", receiptId: p2.body.receipts[0].id },
      debtBefore: "1500",
      debtAfter: "2000",
      cashOut: { method: "Efectivo", amount: "500" },
    });
    const a = await receipt(b, rv.body.receipts[1].id);
    expect(a.snapshot).toMatchObject({ lines: [{ targetType: "sale", saleNumber: "DC-000001", amount: "-500", openBefore: "1500", openAfter: "2000" }] });
    expect((await receipt(b, p2.body.receipts[0].id)).status).toBe("anulado");
    expect((await receipt(b, p2.body.receipts[1].id)).status).toBe("anulado");
    const c = await post(b, `/v1/customers/${ana.id}/payments/${p1.body.id}/correct`, {
      reasonCode: "cliente_equivocado",
      replacement: { customerId: beto.id, amount: 1000, method: "Efectivo", requestId: randomUUID() },
    });
    expect(c.status).toBe(201);
    expect(kinds(c.body.receipts)).toEqual([["reversal", "DC-R-000002"], ["allocation", "DC-R-000002/D1"]]);
    expect(kinds(c.body.replacementPayment.receipts)).toEqual([["payment", "DC-P-000003"], ["allocation", "DC-P-000003/D1"]]);
    const cr = await receipt(b, c.body.receipts[0].id);
    expect(cr.snapshot).toMatchObject({ reasonCode: "cliente_equivocado", replacementPaymentNumber: "DC-P-000003", original: { number: "DC-P-000001" } });
  });
});
