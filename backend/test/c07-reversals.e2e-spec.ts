import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as bcrypt from "bcrypt";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { CatalogService } from "../src/catalog/catalog.service";
import { publicCustomerLedger } from "../src/customer-access/customer-access.service";
import { installBigIntJson } from "../src/shared/bigint";
import { HttpErrorFilter } from "../src/shared/http/http-error.filter";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

/**
 * C07 — reversos financieros (SPEC-C07 §11 T1–T35). Every case ends with the
 * C04 invariants (I-A1..I-A7, I-A5 generalised for reversal rows) plus
 * I-R5 / I-R8 over the whole business (`invariants()`).
 */
describe("C07 reversals (DC-05)", () => {
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
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  type Biz = { token: string; biz: string; productId: string; userId: string };
  let seq = 0;
  async function newBiz(openCaja = true, opening = 0): Promise<Biz> {
    seq += 1;
    const owner = await seedOwner(app, `c07-${seq}@test.co`, `C07-${seq}`);
    const b: Biz = { token: owner.accessToken, biz: owner.business.id, productId: "", userId: owner.user.id };
    const p = await post(b, "/v1/products", { name: "Bombón", price: 1000, stock: 10_000, avgCost: 400 });
    expect(p.status).toBe(201);
    b.productId = p.body.id;
    if (openCaja) expect((await post(b, "/v1/cash/sessions", { openingFloat: opening })).status).toBe(201);
    return b;
  }

  const api = () => request(app.getHttpServer());
  const auth = (b: { token: string; biz: string }) => ({ Authorization: `Bearer ${b.token}`, "X-Business-Id": b.biz });
  function post(b: { token: string; biz: string }, url: string, body: object, key: string = randomUUID()) {
    return api().post(url).set(auth(b)).set("Idempotency-Key", key).send(body);
  }
  const get = (b: { token: string; biz: string }, url: string) => api().get(url).set(auth(b));

  async function customer(b: Biz, name = "Ana") {
    const r = await post(b, "/v1/customers", { name });
    expect(r.status).toBe(201);
    return r.body.id as string;
  }
  async function sale(b: Biz, body: object) {
    const r = await post(b, "/v1/sales", body);
    expect(r.status).toBe(201);
    return r.body as { id: string; lines: Array<{ id: string }> };
  }
  const fiada = async (b: Biz, customerId: string, total: number, qty = 1) =>
    (await sale(b, { lines: [{ productId: b.productId, qty, unitPrice: total / qty }], paymentKind: "credit", customerId, amountReceived: 0 })).id;
  const cashSale = (b: Biz, total: number, method: "Efectivo" | "Nequi" = "Efectivo", qty = 1, customerId?: string) =>
    sale(b, { lines: [{ productId: b.productId, qty, unitPrice: total / qty }], paymentKind: "paid", amountReceived: total, method, ...(customerId ? { customerId } : {}) });
  async function pay(b: Biz, customerId: string, body: object) {
    const r = await post(b, `/v1/customers/${customerId}/payments`, { method: "Efectivo", ...body });
    expect(r.status).toBe(201);
    return r.body as { id: string };
  }
  const voidSale = (b: { token: string; biz: string }, id: string, body: object = { reasonCode: "error_digitacion" }, key?: string, dry = false) =>
    post(b, `/v1/sales/${id}/void${dry ? "?dryRun=true" : ""}`, body, key);
  const reversePay = (b: { token: string; biz: string }, c: string, p: string, body: object = { reasonCode: "monto_equivocado" }, key?: string, dry = false) =>
    post(b, `/v1/customers/${c}/payments/${p}/reverse${dry ? "?dryRun=true" : ""}`, body, key);
  async function ledger(b: Biz, customerId: string) {
    const r = await get(b, `/v1/customers/${customerId}/ledger`);
    expect(r.status).toBe(200);
    return r.body;
  }
  const openOf = (l: { sales: Array<{ id: string; openBalance: number }> }, id: string) => l.sales.find((s) => s.id === id)!.openBalance;
  async function today(b: Biz) {
    const r = await get(b, "/v1/cash/today");
    expect(r.status).toBe(200);
    return r.body;
  }
  const stock = async (b: Biz) => (await prisma.product.findUniqueOrThrow({ where: { id: b.productId } })).stock;

  /** I-R1 / I-R12 — row hash of every business table (originals never change). */
  async function snapshot(b: Biz) {
    const rows = await prisma.$queryRawUnsafe<Array<{ t: string; h: string; n: number }>>(
      `SELECT t, md5(string_agg(j, '|' ORDER BY j)) h, count(*)::int n FROM (
         SELECT 'sales' t, row_to_json(x)::text j FROM sales x WHERE business_id = $1::uuid
         UNION ALL SELECT 'sale_lines', row_to_json(x)::text FROM sale_lines x JOIN sales s ON s.id = x.sale_id WHERE s.business_id = $1::uuid
         UNION ALL SELECT 'customer_payments', row_to_json(x)::text FROM customer_payments x WHERE business_id = $1::uuid
         UNION ALL SELECT 'cash_moves', row_to_json(x)::text FROM cash_moves x WHERE business_id = $1::uuid
         UNION ALL SELECT 'cash_sessions', row_to_json(x)::text FROM cash_sessions x WHERE business_id = $1::uuid
         UNION ALL SELECT 'sale_returns', row_to_json(x)::text FROM sale_returns x WHERE business_id = $1::uuid
         UNION ALL SELECT 'debt_allocations', row_to_json(x)::text FROM debt_allocations x WHERE business_id = $1::uuid
         UNION ALL SELECT 'stock_moves', row_to_json(x)::text FROM stock_moves x WHERE business_id = $1::uuid
         UNION ALL SELECT 'customers', row_to_json(x)::text FROM customers x WHERE business_id = $1::uuid
         UNION ALL SELECT 'products', row_to_json(x)::text FROM products x WHERE business_id = $1::uuid
         UNION ALL SELECT 'reversals', row_to_json(x)::text FROM reversals x WHERE business_id = $1::uuid
       ) q GROUP BY t ORDER BY t`,
      b.biz,
    );
    return Object.fromEntries(rows.map((r) => [r.t, `${r.n}:${r.h}`]));
  }
  /** I-R1: every row that existed before is byte-identical after. */
  async function originalsUnchanged(b: Biz, before: Map<string, string>) {
    const after = await rowHashes(b);
    for (const [k, v] of before) expect([k, after.get(k)]).toEqual([k, v]);
  }
  async function rowHashes(b: Biz) {
    const rows = await prisma.$queryRawUnsafe<Array<{ k: string; h: string }>>(
      `SELECT 'sales:'||id k, md5(row_to_json(x)::text) h FROM sales x WHERE business_id = $1::uuid
       UNION ALL SELECT 'sale_lines:'||x.id, md5(row_to_json(x)::text) FROM sale_lines x JOIN sales s ON s.id = x.sale_id WHERE s.business_id = $1::uuid
       UNION ALL SELECT 'customer_payments:'||id, md5(row_to_json(x)::text) FROM customer_payments x WHERE business_id = $1::uuid
       UNION ALL SELECT 'cash_moves:'||id, md5(row_to_json(x)::text) FROM cash_moves x WHERE business_id = $1::uuid
       UNION ALL SELECT 'sale_returns:'||id, md5(row_to_json(x)::text) FROM sale_returns x WHERE business_id = $1::uuid
       UNION ALL SELECT 'debt_allocations:'||id, md5(row_to_json(x)::text) FROM debt_allocations x WHERE business_id = $1::uuid`,
      b.biz,
    );
    return new Map(rows.map((r) => [r.k, r.h]));
  }

  /** C04 §5 I-A1..I-A7 (I-A5 generalised: − Σ reversal rows) + I-R2/I-R5/I-R8/I-R10. */
  async function invariants(b: Biz) {
    const biz = b.biz;
    const badPay = await prisma.$queryRaw<unknown[]>`
      SELECT p.id FROM customer_payments p LEFT JOIN debt_allocations x
        ON x.source_type='payment' AND x.source_id=p.id
      WHERE p.business_id = ${biz}::uuid
      GROUP BY p.id, p.amount HAVING COALESCE(SUM(x.amount),0) <> p.amount`;
    expect(badPay).toEqual([]);
    const badGroups = await prisma.$queryRaw<unknown[]>`
      SELECT group_id FROM debt_allocations WHERE business_id = ${biz}::uuid AND mode IN ('credit_apply','reversal')
      GROUP BY group_id, source_type HAVING source_type <> 'reversal' AND SUM(amount) <> 0`;
    expect(badGroups).toEqual([]);
    const badRet = await prisma.$queryRaw<unknown[]>`
      SELECT r.id FROM sale_returns r LEFT JOIN debt_allocations x
        ON x.source_type='sale_return' AND x.source_id=r.id AND x.target_type <> 'credit' AND x.mode <> 'credit_apply'
      WHERE r.business_id = ${biz}::uuid
      GROUP BY r.id, r.debt_reduced HAVING COALESCE(SUM(x.amount),0) <> r.debt_reduced`;
    expect(badRet).toEqual([]);
    const badOpen = await prisma.$queryRaw<unknown[]>`
      WITH obl AS (
        SELECT id, credit AS orig FROM sales WHERE business_id = ${biz}::uuid AND credit > 0
        UNION ALL SELECT id, amount FROM initial_debts WHERE business_id = ${biz}::uuid),
      alloc AS (SELECT COALESCE(sale_id, initial_debt_id) oid, SUM(amount) a FROM debt_allocations
        WHERE business_id = ${biz}::uuid AND target_type <> 'credit' GROUP BY 1)
      SELECT o.id FROM obl o LEFT JOIN alloc a ON a.oid = o.id
      WHERE o.orig - COALESCE(a.a,0) < 0 OR o.orig - COALESCE(a.a,0) > o.orig`;
    expect(badOpen).toEqual([]);
    const badDebt = await prisma.$queryRaw<unknown[]>`
      WITH obl AS (
        SELECT s.business_id, s.customer_id, s.id, s.credit AS orig FROM sales s WHERE s.credit > 0
        UNION ALL SELECT d.business_id, d.customer_id, d.id, d.amount FROM initial_debts d),
      alloc AS (
        SELECT business_id, COALESCE(sale_id, initial_debt_id) oid, SUM(amount) a
        FROM debt_allocations WHERE target_type <> 'credit' GROUP BY 1,2)
      SELECT c.id FROM customers c LEFT JOIN obl o ON o.customer_id = c.id AND o.business_id = c.business_id
      LEFT JOIN alloc a ON a.oid = o.id AND a.business_id = o.business_id
      WHERE c.business_id = ${biz}::uuid
      GROUP BY c.id, c.debt HAVING c.debt <> COALESCE(SUM(o.orig - COALESCE(a.a,0)),0)`;
    expect(badDebt).toEqual([]);
    const badCredit = await prisma.$queryRaw<unknown[]>`
      SELECT c.id FROM customers c LEFT JOIN debt_allocations x ON x.customer_id = c.id AND x.target_type='credit'
      WHERE c.business_id = ${biz}::uuid
      GROUP BY c.id, c.credit_balance HAVING c.credit_balance <> COALESCE(SUM(x.amount),0) OR c.credit_balance < 0 OR c.debt < 0`;
    expect(badCredit).toEqual([]);
    const badI5 = await prisma.$queryRaw<unknown[]>`
      SELECT c.id FROM customers c WHERE c.business_id = ${biz}::uuid AND c.debt <> (
        COALESCE((SELECT SUM(amount) FROM initial_debts WHERE customer_id=c.id),0)
        + COALESCE((SELECT SUM(credit) FROM sales WHERE customer_id=c.id),0)
        - COALESCE((SELECT SUM(amount) FROM customer_payments WHERE customer_id=c.id),0)
        - COALESCE((SELECT SUM(r.debt_reduced) FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=c.id),0)
        - COALESCE((SELECT SUM(amount) FROM debt_allocations WHERE customer_id=c.id AND source_type='sale_return' AND target_type='credit' AND mode <> 'credit_apply'),0)
        - COALESCE((SELECT SUM(amount) FROM debt_allocations WHERE customer_id=c.id AND source_type='credit_refund'),0)
        - COALESCE((SELECT SUM(amount) FROM debt_allocations WHERE customer_id=c.id AND source_type='reversal'),0)
        + c.credit_balance)`;
    expect(badI5).toEqual([]);
    const [cash] = await prisma.$queryRaw<Array<{ a: bigint; b: bigint }>>`
      SELECT COALESCE((SELECT SUM(amount) FROM cash_moves WHERE business_id=${biz}::uuid AND kind='debt_collect'),0)::bigint a,
             COALESCE((SELECT SUM(amount) FROM customer_payments WHERE business_id=${biz}::uuid),0)::bigint b`;
    expect(cash!.a).toBe(cash!.b);
    const badI7 = await prisma.$queryRaw<unknown[]>`
      SELECT x.id FROM debt_allocations x
      LEFT JOIN sales s ON s.id = x.sale_id
      LEFT JOIN initial_debts d ON d.id = x.initial_debt_id
      WHERE x.business_id = ${biz}::uuid AND (
        (x.sale_id IS NOT NULL AND (s.business_id <> x.business_id OR s.customer_id <> x.customer_id))
        OR (x.initial_debt_id IS NOT NULL AND (d.business_id <> x.business_id OR d.customer_id <> x.customer_id)))`;
    expect(badI7).toEqual([]);
    // I-R8: stock = Σ stock_moves.delta
    const badStock = await prisma.$queryRaw<unknown[]>`
      SELECT p.id FROM products p WHERE p.business_id = ${biz}::uuid AND p.stock <>
        COALESCE((SELECT SUM(delta) FROM stock_moves m WHERE m.product_id = p.id),0)`;
    expect(badStock).toEqual([]);
    // I-R10: every reverso cash move sits in an open-or-later-closed session of its own day
    const badMove = await prisma.$queryRaw<unknown[]>`
      SELECT m.id FROM cash_moves m LEFT JOIN cash_sessions s ON s.id = m.session_id
      WHERE m.business_id = ${biz}::uuid AND m.kind = 'reverso' AND (s.id IS NULL OR s.local_date <> m.occurred_on)`;
    expect(badMove).toEqual([]);
    // I-R2 / I-R7 / I-R9
    const badRev = await prisma.$queryRaw<unknown[]>`
      SELECT r.id FROM reversals r LEFT JOIN business_memberships m ON m.business_id = r.business_id AND m.user_id = r.requested_by
      WHERE r.business_id = ${biz}::uuid AND (m.role IS DISTINCT FROM 'owner' OR r.target_type NOT IN ('sale','customer_payment'))`;
    expect(badRev).toEqual([]);
  }

  /** Test-only fixture: move a business' existing day back `days` (local/embedded PG). */
  async function shiftBack(b: Biz, days: number) {
    const biz = b.biz;
    await prisma.$executeRawUnsafe(`UPDATE cash_sessions SET local_date = local_date - $2::int WHERE business_id = $1::uuid`, biz, days);
    await prisma.$executeRawUnsafe(`UPDATE cash_moves SET occurred_on = occurred_on - $2::int WHERE business_id = $1::uuid`, biz, days);
    await prisma.$executeRawUnsafe(`UPDATE sales SET occurred_on = occurred_on - $2::int WHERE business_id = $1::uuid`, biz, days);
    await prisma.$executeRawUnsafe(`UPDATE customer_payments SET occurred_on = occurred_on - $2::int WHERE business_id = $1::uuid`, biz, days);
    await prisma.$executeRawUnsafe(`UPDATE sale_returns SET occurred_on = occurred_on - $2::int WHERE business_id = $1::uuid`, biz, days);
  }

  it("PR1: migration — reversals table, enum values, origin columns and CHECKs", async () => {
    const b = await newBiz(false);
    const base = { payloadHash: "h", businessId: b.biz, targetType: "sale" as const, requestedBy: b.userId, occurredOn: new Date("2026-11-09T00:00:00Z"), before: {}, after: {} };
    await expect(prisma.reversal.create({ data: { ...base, id: randomUUID(), requestId: randomUUID(), number: "DC-R-9", targetId: randomUUID(), reasonCode: "otro", reasonText: "   " } })).rejects.toThrow();
    await expect(prisma.reversal.create({ data: { ...base, id: randomUUID(), requestId: randomUUID(), number: "DC-R-9", targetId: randomUUID(), reasonCode: "duplicado", reasonText: "x".repeat(281) } })).rejects.toThrow();
    const c = await customer(b);
    await expect(prisma.debtAllocation.create({ data: { id: randomUUID(), businessId: b.biz, customerId: c, sourceType: "payment", sourceId: randomUUID(), groupId: randomUUID(), mode: "fifo", amount: 1n, targetType: "credit", originSourceType: "payment", originSourceId: randomUUID() } })).rejects.toThrow();
    const kinds = await prisma.$queryRaw<Array<{ v: string }>>`SELECT unnest(enum_range(NULL::"CashMoveKind"))::text v`;
    expect(kinds.map((k) => k.v)).toContain("reverso");
    const reasons = await prisma.$queryRaw<Array<{ v: string }>>`SELECT unnest(enum_range(NULL::"StockMoveReason"))::text v`;
    expect(reasons.map((k) => k.v)).toContain("anulacion");
  });

  it("T1/T2/T22/T28/T17/I-R1/I-R6: void Efectivo and Nequi sales — stock back, out reverso by method, expectedEfectivo, warning, numbering, stats", async () => {
    const b = await newBiz(true, 0);
    const s1 = await cashSale(b, 2000, "Efectivo", 2);
    const s2 = await cashSale(b, 3000, "Nequi", 3);
    const t0 = await today(b);
    expect(t0.expectedEfectivo).toBe(2000);
    expect(t0.expectedEfectivo).toBe(t0.expected.efectivo);
    const stock0 = await stock(b);
    const before = await rowHashes(b);

    const r1 = await voidSale(b, s1.id);
    expect(r1.status).toBe(201);
    expect(r1.body.number).toBe("DC-R-000001");
    expect(r1.body.effects.cashMoves).toEqual([{ direction: "out", kind: "reverso", method: "Efectivo", amount: 2000, sessionId: t0.session.id }]);
    expect(r1.body.effects.stockMoves).toEqual([expect.objectContaining({ productId: b.productId, delta: 2, reason: "anulacion" })]);
    expect(await stock(b)).toBe(stock0 + 2);
    const t1 = await today(b);
    expect([t1.expectedEfectivo, t1.expectedNequi]).toEqual([0, 3000]);
    expect(t1.moves).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "reverso", direction: "out", method: "Efectivo", amount: 2000, refType: "reversal", refId: r1.body.id })]));

    const r2 = await voidSale(b, s2.id, { reasonCode: "duplicado" });
    expect([r2.status, r2.body.number]).toEqual([201, "DC-R-000002"]);
    const t2 = await today(b);
    expect([t2.expectedEfectivo, t2.expectedNequi]).toEqual([0, 0]); // T2: Nequi never touches efectivo
    await originalsUnchanged(b, before);

    // T22: a reverso that leaves expected efectivo at −500 → 201 + warning
    const s3 = await cashSale(b, 2000, "Efectivo");
    expect((await post(b, "/v1/cash/retiros", { amount: 500, method: "Efectivo" })).status).toBe(201);
    const r3 = await voidSale(b, s3.id);
    expect(r3.status).toBe(201);
    expect(r3.body.warnings).toEqual(["EXPECTED_CASH_NEGATIVE"]);
    expect((await today(b)).expectedEfectivo).toBe(-500);

    // T17: today's stats exclude what was voided
    const st = await get(b, "/v1/stats?period=hoy");
    expect(st.status).toBe(200);
    expect([st.body.ventas, st.body.anulado, st.body.anuladoCount, st.body.recibido]).toEqual([0, 7000, 3, 0]);

    // T28: another business starts its own sequence
    const other = await newBiz(true);
    const o = await cashSale(other, 1000);
    expect((await voidSale(other, o.id)).body.number).toBe("DC-R-000001");

    // GET reversals + voucher
    const list = await get(b, "/v1/reversals");
    expect(list.status).toBe(200);
    expect(list.body.map((r: { number: string }) => r.number)).toEqual(["DC-R-000003", "DC-R-000002", "DC-R-000001"]);
    const v = await get(b, `/v1/reversals/${r1.body.id}`);
    expect(v.status).toBe(200);
    expect(v.body.voucher).toMatchObject({ kind: "reversal", number: "DC-R-000001", reasonCode: "error_digitacion", cashOut: 2000, method: "Efectivo" });
    expect(v.body.voucher.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const sd = await get(b, `/v1/sales/${s1.id}`);
    expect(sd.body.reversal).toMatchObject({ id: r1.body.id, number: "DC-R-000001", reasonCode: "error_digitacion" });
    const sl = await get(b, "/v1/sales");
    expect(sl.body.find((x: { id: string }) => x.id === s1.id).reversal.number).toBe("DC-R-000001");
    await invariants(b);
    await invariants(other);
  });

  it("T6/T7/T8/T16: void fiadas — debt down, paid abono goes to saldo a favor or is re-imputed FIFO; caja unchanged; portal shows «Anulada»", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const s6 = await fiada(b, c, 3000);
    const r6 = await voidSale(b, s6);
    expect(r6.status).toBe(201);
    expect([r6.body.effects.debtBefore, r6.body.effects.debtAfter, r6.body.effects.cashMoves]).toEqual([3000, 0, []]);

    // T7
    const c7 = await customer(b, "Rosa");
    const s7 = await fiada(b, c7, 3000);
    await pay(b, c7, { amount: 3000 });
    const exp0 = (await today(b)).expectedEfectivo;
    const before = await rowHashes(b);
    const r7 = await voidSale(b, s7, { reasonCode: "cliente_equivocado" });
    expect(r7.status).toBe(201);
    let l = await ledger(b, c7);
    expect([l.customer.debt, l.customer.creditBalance, openOf(l, s7)]).toEqual([0, 3000, 0]);
    expect((await today(b)).expectedEfectivo).toBe(exp0);
    await originalsUnchanged(b, before);
    // T16: portal — nothing disappears, sale «Anulada · motivo», saldo a favor visible
    const pub = publicCustomerLedger(await app.get(CatalogService).portalCustomerLedger({ kind: "portal", customerId: c7, businessId: b.biz, timezone: "America/Bogota" }));
    const ps = pub.sales.find((s) => s.id === s7)!;
    expect(ps.reversal).toEqual({ number: r7.body.number, reasonCode: "cliente_equivocado", createdAt: expect.anything() });
    expect(pub.payments).toHaveLength(1);
    expect(JSON.stringify(pub)).not.toContain(b.userId);

    // T8
    const c8 = await customer(b, "Beto");
    const s8 = await fiada(b, c8, 3000);
    const p8 = await pay(b, c8, { amount: 3000 });
    const other = await fiada(b, c8, 2000);
    const r8 = await voidSale(b, s8);
    expect(r8.status).toBe(201);
    l = await ledger(b, c8);
    expect([l.customer.debt, l.customer.creditBalance, openOf(l, other), openOf(l, s8)]).toEqual([0, 1000, 0, 0]);
    // the abono now shows where its money went (origin-aware)
    const lp = l.payments.find((p: { id: string }) => p.id === p8.id);
    expect(lp.reversal).toBeNull();
    await invariants(b);
  });

  it("T9/T33/T34/T35/I-R11: void after returns — only the remainder; returns untouched; fully returned → 422 NOTHING_TO_VOID", async () => {
    const b = await newBiz(true, 0);
    // T33: cash 3 × 1000 Efectivo, return 1 refunded, then void → stock +2, out reverso 2000
    const s33 = await cashSale(b, 3000, "Efectivo", 3);
    const ret = await post(b, `/v1/sales/${s33.id}/returns`, { lines: [{ saleLineId: s33.lines[0]!.id, qty: 1 }] });
    expect([ret.status, ret.body.refundAmount]).toEqual([201, 1000]);
    const before = await rowHashes(b);
    const st0 = await stock(b);
    const r33 = await voidSale(b, s33.id);
    expect(r33.status).toBe(201);
    expect(r33.body.effects.cashMoves).toEqual([expect.objectContaining({ method: "Efectivo", amount: 2000 })]);
    expect(await stock(b)).toBe(st0 + 2);
    await originalsUnchanged(b, before);
    // I-R3: Σ cash for the sale per method = 0, Σ stock for the sale's product = 0
    const [net] = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT (SELECT SUM(CASE WHEN direction='in' THEN amount ELSE -amount END) FROM cash_moves
              WHERE business_id=${b.biz}::uuid AND (ref_id=${s33.id}::uuid OR ref_id=${ret.body.id}::uuid OR ref_id=${r33.body.id}::uuid))::bigint n`;
    expect(net!.n).toBe(0n);

    // T34: fiada 3000, return 1000 (debtReduced), abono 1000, then void → abono to saldo a favor
    const c = await customer(b);
    const s34 = await sale(b, { lines: [{ productId: b.productId, qty: 3, unitPrice: 1000 }], paymentKind: "credit", customerId: c, amountReceived: 0 });
    const r = await post(b, `/v1/sales/${s34.id}/returns`, { lines: [{ saleLineId: s34.lines[0]!.id, qty: 1 }] });
    expect([r.status, r.body.debtReduced]).toEqual([201, 1000]);
    await pay(b, c, { amount: 1000 });
    const v34 = await voidSale(b, s34.id);
    expect(v34.status).toBe(201);
    const l = await ledger(b, c);
    expect([l.customer.debt, l.customer.creditBalance, openOf(l, s34.id)]).toEqual([0, 1000, 0]);
    expect(v34.body.effects.cashMoves).toEqual([]);

    // T9: partial return on a fiada then void → only the remainder comes back
    const s9 = await sale(b, { lines: [{ productId: b.productId, qty: 4, unitPrice: 500 }], paymentKind: "credit", customerId: c, amountReceived: 0 });
    await post(b, `/v1/sales/${s9.id}/returns`, { lines: [{ saleLineId: s9.lines[0]!.id, qty: 1 }] });
    const st9 = await stock(b);
    const v9 = await voidSale(b, s9.id);
    expect(v9.status).toBe(201);
    expect(await stock(b)).toBe(st9 + 3);
    // G8: a voided sale accepts no more returns (stock/cash would count twice)
    const late = await post(b, `/v1/sales/${s9.id}/returns`, { lines: [{ saleLineId: s9.lines[0]!.id, qty: 1 }] });
    expect([late.status, late.body.error?.code]).toEqual([409, "ALREADY_REVERSED"]);
    expect(await stock(b)).toBe(st9 + 3);

    // T35: fully returned → nothing to void
    const s35 = await cashSale(b, 1000, "Nequi");
    await post(b, `/v1/sales/${s35.id}/returns`, { lines: [{ saleLineId: s35.lines[0]!.id, qty: 1 }] });
    const v35 = await voidSale(b, s35.id);
    expect([v35.status, v35.body.error.code]).toEqual([422, "NOTHING_TO_VOID"]);
    expect(await prisma.reversal.count({ where: { businessId: b.biz, targetId: s35.id } })).toBe(0);
    await invariants(b);
  });

  it("T10/M12/M12b/T15: reverse a FIFO abono — obligations reopen, debt back, out by method, original kept; second reverse 409; same key replays", async () => {
    const b = await newBiz(true, 0);
    const c = await customer(b);
    const a = await fiada(b, c, 3000);
    const bb = await fiada(b, c, 2000);
    const p = await post(b, `/v1/customers/${c}/payments`, { amount: 5000, method: "Nequi" });
    expect(p.status).toBe(201);
    const before = await rowHashes(b);
    const key = randomUUID();
    const r = await reversePay(b, c, p.body.id, { reasonCode: "monto_equivocado" }, key);
    expect(r.status).toBe(201);
    let l = await ledger(b, c);
    expect([l.customer.debt, openOf(l, a), openOf(l, bb)]).toEqual([5000, 3000, 2000]);
    expect(r.body.effects.cashMoves).toEqual([expect.objectContaining({ method: "Nequi", amount: 5000 })]);
    expect(await prisma.customerPayment.count({ where: { id: p.body.id } })).toBe(1);
    await originalsUnchanged(b, before);
    expect(l.payments.find((x: { id: string }) => x.id === p.body.id).reversal.number).toBe(r.body.number);
    // T15: double tap same key → same reversal; other key → 409
    const replay = await reversePay(b, c, p.body.id, { reasonCode: "monto_equivocado" }, key);
    expect([replay.status, replay.body.id]).toEqual([201, r.body.id]);
    const again = await reversePay(b, c, p.body.id, { reasonCode: "duplicado" });
    expect([again.status, again.body.error.code]).toEqual([409, "ALREADY_REVERSED"]);
    l = await ledger(b, c);
    expect(l.customer.debt).toBe(5000);
    expect(await prisma.reversal.count({ where: { businessId: b.biz } })).toBe(1);
    // same key, different payload → 422 (C02)
    const mism = await reversePay(b, c, p.body.id, { reasonCode: "duplicado" }, key);
    expect(mism.status).toBe(422);

    // M12 shape: 5000 debt, 2000 abono, reversal → debt 5000
    const m = await customer(b, "M12");
    await fiada(b, m, 5000);
    const mp = await pay(b, m, { amount: 2000 });
    expect((await reversePay(b, m, mp.id, { reasonCode: "error_digitacion" })).status).toBe(201);
    expect((await ledger(b, m)).customer.debt).toBe(5000);
    expect((await reversePay(b, m, mp.id, { reasonCode: "error_digitacion" })).status).toBe(409);
    await invariants(b);
  });

  it("T11 / refund edge: reversing an abono whose saldo a favor was applied elsewhere undoes the application; refunded credit → 409", async () => {
    const b = await newBiz(true, 10_000);
    const c = await customer(b);
    const s1 = await fiada(b, c, 1000);
    const p = await pay(b, c, { amount: 3000 }); // 1000 to s1, 2000 to credit
    // C04 T27: a «paid» sale covered by saldo a favor → credit_apply pair
    const s2 = (await sale(b, { lines: [{ productId: b.productId, qty: 1, unitPrice: 1500 }], paymentKind: "paid", customerId: c, amountReceived: 0, applyCredit: true })).id;
    let l = await ledger(b, c);
    expect([l.customer.debt, l.customer.creditBalance, openOf(l, s2)]).toEqual([0, 500, 0]);
    const r = await reversePay(b, c, p.id);
    expect(r.status).toBe(201);
    l = await ledger(b, c);
    expect([l.customer.debt, l.customer.creditBalance, openOf(l, s1), openOf(l, s2)]).toEqual([2500, 0, 1000, 1500]);
    await invariants(b);

    // credit refunded in cash: nothing left to take back → 409 CREDIT_ALREADY_REFUNDED, nothing written
    const c2 = await customer(b, "Refund");
    const p2 = await pay(b, c2, { amount: 2000 });
    expect((await post(b, `/v1/customers/${c2}/credit/refund`, { amount: 2000, method: "Efectivo" })).status).toBe(201);
    const snap = await snapshot(b);
    const blocked = await reversePay(b, c2, p2.id);
    expect([blocked.status, blocked.body.error.code]).toEqual([409, "CREDIT_ALREADY_REFUNDED"]);
    expect(await snapshot(b)).toEqual(snap);
    await invariants(b);
  });

  it("T12/T27: correct an abono to the wrong customer — reverse + new abono in one transaction; replay identical", async () => {
    const b = await newBiz(true, 0);
    const ana = await customer(b, "Ana");
    const beto = await customer(b, "Beto");
    await fiada(b, ana, 4000);
    const sb = await fiada(b, beto, 4000);
    const p = await pay(b, ana, { amount: 3000 });
    const key = randomUUID();
    const repl = randomUUID();
    const body = { reasonCode: "cliente_equivocado", replacement: { customerId: beto, amount: 3000, method: "Efectivo", requestId: repl } };
    const r = await post(b, `/v1/customers/${ana}/payments/${p.id}/correct`, body, key);
    expect(r.status).toBe(201);
    expect(r.body.replacementPayment).toMatchObject({ customerId: beto, amount: 3000 });
    const np = await prisma.customerPayment.findUniqueOrThrow({ where: { id: r.body.replacementPayment.id } });
    expect(np.replacesPaymentId).toBe(p.id);
    expect([(await ledger(b, ana)).customer.debt, openOf(await ledger(b, beto), sb)]).toEqual([4000, 1000]);
    const moves = await prisma.cashMove.findMany({ where: { businessId: b.biz, OR: [{ refId: r.body.id }, { refId: np.id }] } });
    expect(moves.map((m) => `${m.direction}:${m.kind}:${m.amount}`).sort()).toEqual(["in:debt_collect:3000", "out:reverso:3000"]);
    const al = await ledger(b, ana);
    expect(al.payments[0].replacedByPaymentId).toBe(np.id);
    // T27 replay → same result, one new abono
    const again = await post(b, `/v1/customers/${ana}/payments/${p.id}/correct`, body, key);
    expect([again.status, again.body.id, again.body.replacementPayment.id]).toEqual([201, r.body.id, np.id]);
    expect(await prisma.customerPayment.count({ where: { businessId: b.biz, replacesPaymentId: p.id } })).toBe(1);
    // replacement requestId must differ from the reversal key
    const p2 = await pay(b, ana, { amount: 100 });
    const k2 = randomUUID();
    const same = await post(b, `/v1/customers/${ana}/payments/${p2.id}/correct`, { ...body, replacement: { ...body.replacement, amount: 100, requestId: k2 } }, k2);
    expect(same.status).toBe(400);
    // missing replacement → 400
    expect((await post(b, `/v1/customers/${ana}/payments/${p2.id}/correct`, { reasonCode: "monto_equivocado" })).status).toBe(400);
    await invariants(b);
  });

  it("T13/T14/T19/T23/T25: staff 403, reason validation, isolation 404, no reverse of a reverse", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const s = await fiada(b, c, 1000);
    const staffId = randomUUID();
    const email = `c07-staff-${staffId}@test.co`;
    await prisma.user.create({ data: { id: staffId, email, passwordHash: await bcrypt.hash("password12", 12) } });
    await prisma.businessMembership.create({ data: { id: randomUUID(), businessId: b.biz, userId: staffId, role: "staff" } });
    const login = await api().post("/v1/auth/login").send({ email, password: "password12" });
    const staff = { token: login.body.accessToken as string, biz: b.biz };
    expect((await voidSale(staff, s)).status).toBe(403);
    expect((await voidSale(staff, s, { reasonCode: "error_digitacion" }, undefined, true)).status).toBe(403);
    expect((await get(staff, "/v1/reversals")).status).toBe(403);
    expect(await prisma.reversal.count({ where: { businessId: b.biz } })).toBe(0);
    // T14
    expect((await voidSale(b, s, {})).status).toBe(400);
    expect((await voidSale(b, s, { reason: "doble" })).status).toBe(400);
    expect((await voidSale(b, s, { reasonCode: "otro" })).status).toBe(400);
    expect((await voidSale(b, s, { reasonCode: "otro", reasonText: "  ab " })).status).toBe(400);
    expect((await voidSale(b, s, { reasonCode: "duplicado", reasonText: "x".repeat(281) })).status).toBe(400);
    // T25
    expect((await voidSale(b, s, { reasonCode: "porque_si" })).status).toBe(400);
    // T19
    const other = await newBiz();
    expect((await voidSale(other, s)).status).toBe(404);
    expect((await reversePay(other, c, randomUUID())).status).toBe(404);
    // T14: cliente_equivocado without text → 201
    const r = await voidSale(b, s, { reasonCode: "cliente_equivocado" });
    expect(r.status).toBe(201);
    // T23: no route reverses a reversal; its id is not a sale or abono
    expect((await voidSale(b, r.body.id)).status).toBe(404);
    expect((await post(b, `/v1/reversals/${r.body.id}/void`, { reasonCode: "duplicado" })).status).toBe(404);
    // otro with text ok
    const s2 = await fiada(b, c, 500);
    const o = await voidSale(b, s2, { reasonCode: "otro", reasonText: "  Se cayó el sistema " });
    expect([o.status, o.body.reasonText]).toEqual([201, "Se cayó el sistema"]);
    await invariants(b);
  });

  it("T3/T4/T5/T24: closed days immutable — reverso lands in today's open caja; no caja → 409 (fiada without abonos allowed); today closed → 409", async () => {
    const b = await newBiz(true, 0);
    const s = await cashSale(b, 2000, "Efectivo");
    const sess = (await today(b)).session;
    expect((await post(b, `/v1/cash/sessions/${sess.id}/close`, { countedEfectivo: 2000 })).status).toBe(201);
    // T5: today closed → CLOSED_DAY, nothing created
    const t5 = await voidSale(b, s.id);
    expect([t5.status, t5.body.error.code]).toEqual([409, "CLOSED_DAY"]);
    const dry5 = await voidSale(b, s.id, { reasonCode: "error_digitacion" }, undefined, true);
    expect([dry5.status, dry5.body.blockers]).toEqual([200, ["CLOSED_DAY"]]);
    // Make that a past (closed) day — test-only fixture on embedded PG
    await shiftBack(b, 1);
    const closedBefore = await prisma.cashSession.findUniqueOrThrow({ where: { id: sess.id } });
    const statsBefore = await prisma.$queryRaw<unknown[]>`SELECT * FROM cash_moves WHERE session_id = ${sess.id}::uuid ORDER BY id`;
    // T4: no caja today, money involved → 409
    const t4 = await voidSale(b, s.id);
    expect([t4.status, t4.body.error.code]).toEqual([409, "CASH_SESSION_REQUIRED"]);
    const c = await customer(b);
    const f = await fiada(b, c, 1000);
    expect((await voidSale(b, f)).status).toBe(201); // fiada without abonos: no caja needed
    // T3: open today → the reverso enters today's session; the closed one is identical
    expect((await post(b, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    const t3 = await voidSale(b, s.id);
    expect(t3.status).toBe(201);
    const todaySess = (await today(b)).session;
    expect(t3.body.effects.cashMoves[0].sessionId).toBe(todaySess.id);
    expect(await prisma.cashSession.findUniqueOrThrow({ where: { id: sess.id } })).toEqual(closedBefore);
    expect(await prisma.$queryRaw<unknown[]>`SELECT * FROM cash_moves WHERE session_id = ${sess.id}::uuid ORDER BY id`).toEqual(statsBefore);
    expect((await get(b, `/v1/cash/sessions/${sess.id}`)).body.expected?.efectivo ?? 2000).toBe(2000);
    await invariants(b);
  });

  it("T21: original older than 30 days needs confirmOld", async () => {
    const b = await newBiz(true, 0);
    const c = await customer(b);
    const s = await fiada(b, c, 1000);
    const p = await pay(b, c, { amount: 400 });
    await prisma.$executeRawUnsafe(`UPDATE sales SET occurred_on = occurred_on - 31 WHERE id = $1::uuid`, s);
    await prisma.$executeRawUnsafe(`UPDATE customer_payments SET occurred_on = occurred_on - 31 WHERE id = $1::uuid`, p.id);
    const no = await voidSale(b, s);
    expect([no.status, no.body.error.code]).toEqual([409, "CONFIRM_OLD_REQUIRED"]);
    const noP = await reversePay(b, c, p.id);
    expect([noP.status, noP.body.error.code]).toEqual([409, "CONFIRM_OLD_REQUIRED"]);
    const ok = await voidSale(b, s, { reasonCode: "error_digitacion", confirmOld: true });
    expect([ok.status, ok.body.oldConfirmed]).toEqual([201, true]);
    await invariants(b);
  });

  it("T29/T30/T31/T32/I-R12: dryRun previews effects, writes nothing, does not register the key; real call with the same key executes", async () => {
    const b = await newBiz(true, 0);
    const c = await customer(b);
    const s = await fiada(b, c, 3000);
    await pay(b, c, { amount: 1000 });
    const k = randomUUID();
    const snap0 = await snapshot(b);
    const d1 = await voidSale(b, s, { reasonCode: "error_digitacion" }, k, true);
    expect(d1.status).toBe(200);
    expect(d1.body).toMatchObject({ dryRun: true, blockers: [], warnings: [] });
    const d2 = await voidSale(b, s, { reasonCode: "error_digitacion" }, k, true);
    expect(d2.body.effects).toEqual(d1.body.effects); // T32
    expect(await snapshot(b)).toEqual(snap0);
    const real = await voidSale(b, s, { reasonCode: "error_digitacion" }, k);
    expect(real.status).toBe(201); // T30
    expect(real.body.dryRun).toBeUndefined();
    expect(real.body.number).toBe("DC-R-000001"); // sequence did not advance on dryRun
    expect(real.body.effects).toEqual(d1.body.effects); // I-R12
    // T31: already reversed → 409, no caja → blocker
    const d3 = await voidSale(b, s, { reasonCode: "error_digitacion" }, undefined, true);
    expect([d3.status, d3.body.error.code]).toEqual([409, "ALREADY_REVERSED"]);
    const nb = await newBiz(false);
    const ns = await cashSale(nb, 1000, "Nequi"); // no caja: the move stays unassigned (C01)
    const d4 = await voidSale(nb, ns.id, { reasonCode: "error_digitacion" }, undefined, true);
    expect([d4.status, d4.body.blockers]).toEqual([200, ["CASH_SESSION_REQUIRED"]]);
    expect(await prisma.reversal.count({ where: { businessId: nb.biz } })).toBe(0);
    await invariants(b);
  });

  it("concurrency: two parallel reverses of the same abono with different keys → exactly one 201, one 409", async () => {
    const b = await newBiz(true, 0);
    const c = await customer(b);
    await fiada(b, c, 5000);
    const p = await pay(b, c, { amount: 2000 });
    const rs = await Promise.all([reversePay(b, c, p.id), reversePay(b, c, p.id), voidSale(b, (await fiada(b, c, 700)))]);
    expect(rs.slice(0, 2).map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await ledger(b, c)).customer.debt).toBe(5000);
    await invariants(b);
  });
});
