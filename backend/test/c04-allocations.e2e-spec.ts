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
 * C04 — imputación de abonos (SPEC-C04 v3.2 §10). Every case ends with the
 * §5 invariants I-A1..I-A7 over the whole business (`invariants()`).
 */
describe("C04 debt allocations (DC-04 / DC-20 / DC-54)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;

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
  async function newBiz(openCaja = true): Promise<Biz> {
    seq += 1;
    const owner = await seedOwner(app, `c04-${seq}@test.co`, `C04-${seq}`);
    const b: Biz = { token: owner.accessToken, biz: owner.business.id, productId: "", userId: owner.user.id };
    const p = await post(b, "/v1/products", { name: "Bombón", price: 1000, stock: 10_000, avgCost: 100 });
    expect(p.status).toBe(201);
    b.productId = p.body.id;
    if (openCaja) expect((await post(b, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    return b;
  }

  const api = () => request(app.getHttpServer());
  const auth = (b: { token: string; biz: string }) => ({ Authorization: `Bearer ${b.token}`, "X-Business-Id": b.biz });
  function post(b: { token: string; biz: string }, url: string, body: object, key: string = randomUUID(), headers: Record<string, string> = {}) {
    return api().post(url).set(auth(b)).set("Idempotency-Key", key).set(headers).send(body);
  }
  const get = (b: Biz, url: string) => api().get(url).set(auth(b));

  async function customer(b: Biz, name = "Ana") {
    const r = await post(b, "/v1/customers", { name });
    expect(r.status).toBe(201);
    return r.body.id as string;
  }
  async function fiada(b: Biz, customerId: string, total: number, key: string = randomUUID()) {
    const r = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: total }], paymentKind: "credit", customerId, amountReceived: 0 }, key);
    expect(r.status).toBe(201);
    return r.body.id as string;
  }
  async function pay(b: Biz, customerId: string, body: object, key?: string, headers?: Record<string, string>) {
    return post(b, `/v1/customers/${customerId}/payments`, { method: "Efectivo", ...body }, key, headers);
  }
  async function ledger(b: Biz, customerId: string) {
    const r = await get(b, `/v1/customers/${customerId}/ledger`);
    expect(r.status).toBe(200);
    return r.body;
  }
  const openOf = (l: { sales: Array<{ id: string; openBalance: number }> }, id: string) => l.sales.find((s) => s.id === id)!.openBalance;

  /** §5 I-A1..I-A7 (I-A5 generalised for return→credit and refunds; see cycles/C04.md). */
  async function invariants(b: Biz) {
    const biz = b.biz;
    // I-A1 payments: Σ rows = amount (credit_apply pairs sum 0)
    const badPay = await prisma.$queryRaw<unknown[]>`
      SELECT p.id FROM customer_payments p LEFT JOIN debt_allocations x
        ON x.source_type='payment' AND x.source_id=p.id
      WHERE p.business_id = ${biz}::uuid
      GROUP BY p.id, p.amount HAVING COALESCE(SUM(x.amount),0) <> p.amount`;
    expect(badPay).toEqual([]);
    const badGroups = await prisma.$queryRaw<unknown[]>`
      SELECT group_id FROM debt_allocations WHERE business_id = ${biz}::uuid AND mode='credit_apply'
      GROUP BY group_id HAVING SUM(amount) <> 0`;
    expect(badGroups).toEqual([]);
    // I-A1 returns: Σ obligation rows (own distribution) = debtReduced
    const badRet = await prisma.$queryRaw<unknown[]>`
      SELECT r.id FROM sale_returns r LEFT JOIN debt_allocations x
        ON x.source_type='sale_return' AND x.source_id=r.id AND x.target_type <> 'credit' AND x.mode <> 'credit_apply'
      WHERE r.business_id = ${biz}::uuid
      GROUP BY r.id, r.debt_reduced HAVING COALESCE(SUM(x.amount),0) <> r.debt_reduced`;
    expect(badRet).toEqual([]);
    // I-A2: 0 ≤ open ≤ original
    const badOpen = await prisma.$queryRaw<unknown[]>`
      WITH obl AS (
        SELECT id, credit AS orig FROM sales WHERE business_id = ${biz}::uuid AND credit > 0
        UNION ALL SELECT id, amount FROM initial_debts WHERE business_id = ${biz}::uuid),
      alloc AS (SELECT COALESCE(sale_id, initial_debt_id) oid, SUM(amount) a FROM debt_allocations
        WHERE business_id = ${biz}::uuid AND target_type <> 'credit' GROUP BY 1)
      SELECT o.id FROM obl o LEFT JOIN alloc a ON a.oid = o.id
      WHERE o.orig - COALESCE(a.a,0) < 0 OR o.orig - COALESCE(a.a,0) > o.orig`;
    expect(badOpen).toEqual([]);
    // I-A3 (SPEC §5 SQL, scoped to this business)
    const badDebt = await prisma.$queryRaw<unknown[]>`
      WITH obl AS (
        SELECT s.business_id, s.customer_id, s.id, s.credit AS orig, 'sale' t FROM sales s WHERE s.credit > 0
        UNION ALL SELECT d.business_id, d.customer_id, d.id, d.amount, 'initial_debt' FROM initial_debts d),
      alloc AS (
        SELECT business_id, COALESCE(sale_id, initial_debt_id) oid, SUM(amount) a
        FROM debt_allocations WHERE target_type <> 'credit' GROUP BY 1,2)
      SELECT c.id, c.debt, COALESCE(SUM(o.orig - COALESCE(a.a,0)),0) reconstructed
      FROM customers c LEFT JOIN obl o ON o.customer_id = c.id AND o.business_id = c.business_id
      LEFT JOIN alloc a ON a.oid = o.id AND a.business_id = o.business_id
      WHERE c.business_id = ${biz}::uuid
      GROUP BY c.id, c.debt HAVING c.debt <> COALESCE(SUM(o.orig - COALESCE(a.a,0)),0)`;
    expect(badDebt).toEqual([]);
    // I-A4
    const badCredit = await prisma.$queryRaw<unknown[]>`
      SELECT c.id FROM customers c LEFT JOIN debt_allocations x ON x.customer_id = c.id AND x.target_type='credit'
      WHERE c.business_id = ${biz}::uuid
      GROUP BY c.id, c.credit_balance HAVING c.credit_balance <> COALESCE(SUM(x.amount),0) OR c.credit_balance < 0`;
    expect(badCredit).toEqual([]);
    // I-A5 (generalised): debt = Σinit + Σcredit − Σpay − ΣdebtReduced − ΣreturnToCredit + Σrefunded + credit_balance
    const badI5 = await prisma.$queryRaw<unknown[]>`
      SELECT c.id FROM customers c WHERE c.business_id = ${biz}::uuid AND c.debt <> (
        COALESCE((SELECT SUM(amount) FROM initial_debts WHERE customer_id=c.id),0)
        + COALESCE((SELECT SUM(credit) FROM sales WHERE customer_id=c.id),0)
        - COALESCE((SELECT SUM(amount) FROM customer_payments WHERE customer_id=c.id),0)
        - COALESCE((SELECT SUM(r.debt_reduced) FROM sale_returns r JOIN sales s ON s.id=r.sale_id WHERE s.customer_id=c.id),0)
        - COALESCE((SELECT SUM(amount) FROM debt_allocations WHERE customer_id=c.id AND source_type='sale_return' AND target_type='credit' AND mode <> 'credit_apply'),0)
        - COALESCE((SELECT SUM(amount) FROM debt_allocations WHERE customer_id=c.id AND source_type='credit_refund'),0)
        + c.credit_balance)`;
    expect(badI5).toEqual([]);
    // I-A5b: value = debtReduced + refundAmount + toCredit
    const badI5b = await prisma.$queryRaw<unknown[]>`
      SELECT r.id FROM sale_returns r WHERE r.business_id = ${biz}::uuid AND
        (SELECT SUM(qty * unit_price) FROM sale_return_lines WHERE return_id=r.id)
        <> r.debt_reduced + r.refund_amount
           + COALESCE((SELECT SUM(amount) FROM debt_allocations WHERE source_type='sale_return' AND source_id=r.id AND target_type='credit' AND mode <> 'credit_apply'),0)`;
    expect(badI5b).toEqual([]);
    // I-A6: allocation never touches caja — Σ debt_collect = Σ payments
    const [cash] = await prisma.$queryRaw<Array<{ a: bigint; b: bigint }>>`
      SELECT COALESCE((SELECT SUM(amount) FROM cash_moves WHERE business_id=${biz}::uuid AND kind='debt_collect'),0)::bigint a,
             COALESCE((SELECT SUM(amount) FROM customer_payments WHERE business_id=${biz}::uuid),0)::bigint b`;
    expect(cash!.a).toBe(cash!.b);
    // I-A7: same business/customer as target
    const badI7 = await prisma.$queryRaw<unknown[]>`
      SELECT x.id FROM debt_allocations x
      LEFT JOIN sales s ON s.id = x.sale_id
      LEFT JOIN initial_debts d ON d.id = x.initial_debt_id
      WHERE x.business_id = ${biz}::uuid AND (
        (x.sale_id IS NOT NULL AND (s.business_id <> x.business_id OR s.customer_id <> x.customer_id))
        OR (x.initial_debt_id IS NOT NULL AND (d.business_id <> x.business_id OR d.customer_id <> x.customer_id)))`;
    expect(badI7).toEqual([]);
  }

  it("PR2: migration — table, enums, CHECKs and additive columns exist", async () => {
    const cols = await prisma.$queryRaw<Array<{ t: string; c: string }>>`
      SELECT table_name t, column_name c FROM information_schema.columns
      WHERE table_schema='public' AND (table_name='debt_allocations'
        OR (table_name='customers' AND column_name='credit_balance')
        OR (table_name='customer_payments' AND column_name IN ('requested_target','allocation_adjusted','adjusted_reviewed_at','adjusted_reviewed_by','replaces_payment_id','sale_id'))
        OR (table_name='sale_returns' AND column_name IN ('needs_review','remainder_mode')))`;
    const have = new Set(cols.map((r) => `${r.t}.${r.c}`));
    for (const c of ["debt_allocations.group_id", "debt_allocations.created_by", "customers.credit_balance", "customer_payments.requested_target", "customer_payments.allocation_adjusted", "customer_payments.adjusted_reviewed_by", "customer_payments.replaces_payment_id", "customer_payments.sale_id", "sale_returns.needs_review", "sale_returns.remainder_mode"]) {
      expect(have.has(c)).toBe(true);
    }
    const b = await newBiz(false);
    const c = await customer(b);
    const row = (over: object) => ({ id: randomUUID(), businessId: b.biz, customerId: c, sourceType: "payment" as const, sourceId: randomUUID(), groupId: randomUUID(), mode: "fifo" as const, amount: 1n, targetType: "credit" as const, ...over });
    await expect(prisma.debtAllocation.create({ data: row({ amount: 0n }) })).rejects.toThrow();
    await expect(prisma.debtAllocation.create({ data: row({ targetType: "sale" }) })).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE customers SET debt = -1 WHERE id = ${c}::uuid`).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE customers SET credit_balance = -1 WHERE id = ${c}::uuid`).rejects.toThrow();
    const kinds = await prisma.$queryRaw<Array<{ v: string }>>`SELECT unnest(enum_range(NULL::"CashMoveKind"))::text v`;
    expect(kinds.map((k) => k.v)).toContain("reembolso_saldo");
  });

  it("T1/T22-base: one fiada 3000 + abono 3000 → open 0, debt 0; portal says Saldada data (openBalance 0), no createdBy", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const s = await fiada(b, c, 3000);
    const r = await pay(b, c, { amount: 3000 });
    expect(r.status).toBe(201);
    expect(r.body.allocations).toEqual([{ targetType: "sale", saleId: s, initialDebtId: null, amount: 3000, openBefore: 3000, openAfter: 0 }]);
    expect([r.body.debtBefore, r.body.debtAfter, r.body.creditBalanceAfter, r.body.adjusted]).toEqual([3000, 0, 0, false]);
    const l = await ledger(b, c);
    expect(openOf(l, s)).toBe(0);
    expect(l.customer.debt).toBe(0);
    const pub = publicCustomerLedger(await app.get(CatalogService).portalCustomerLedger({ kind: "portal", customerId: c, businessId: b.biz, timezone: "America/Bogota" }));
    expect(pub.sales[0]!.openBalance).toBe(0);
    expect(JSON.stringify(pub)).not.toContain("createdBy");
    await invariants(b);
  });

  it("T2/T22: A 3000 then B 2000, FIFO 4000 → A 3000, B 1000; portal A 0 / B 1000", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const A = await fiada(b, c, 3000);
    const B = await fiada(b, c, 2000);
    const r = await pay(b, c, { amount: 4000 });
    expect(r.status).toBe(201);
    expect(r.body.allocations.map((a: { saleId: string; amount: number }) => [a.saleId, a.amount])).toEqual([[A, 3000], [B, 1000]]);
    const l = await ledger(b, c);
    expect([openOf(l, A), openOf(l, B), l.customer.debt]).toEqual([0, 1000, 1000]);
    expect(l.payments[0].allocations.map((a: { saleId: string; createdBy: string }) => a.createdBy)).toEqual([b.userId, b.userId]);
    const pub = publicCustomerLedger(await app.get(CatalogService).portalCustomerLedger({ kind: "portal", customerId: c, businessId: b.biz, timezone: "America/Bogota" }));
    expect(pub.sales.map((s) => [s.id, s.openBalance])).toEqual([[A, 0], [B, 1000]]);
    expect(pub.payments[0]!.allocations).toHaveLength(2);
    expect(pub.payments[0]!.allocations).toEqual(expect.arrayContaining([{ targetType: "sale", targetId: A, amount: 3000 }, { targetType: "sale", targetId: B, amount: 1000 }]));
    await invariants(b);
  });

  it("T3: partial sale (6000, received 2000) + abono 4000 → open 0, amountReceived unchanged", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const s = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: 6000 }], paymentKind: "partial", customerId: c, amountReceived: 2000, method: "Efectivo" });
    expect(s.status).toBe(201);
    expect((await pay(b, c, { amount: 4000 })).status).toBe(201);
    const l = await ledger(b, c);
    expect(openOf(l, s.body.id)).toBe(0);
    expect(l.sales[0].amountReceived).toBe(2000);
    await invariants(b);
  });

  it("T4/R7: initial debt 10000 (older) + sale 3000 + abono 5000 → initial open 5000, sale 3000; initial debt never consumes credit", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const d = await post(b, `/v1/customers/${c}/initial-debts`, { amount: 10000 });
    const s = await fiada(b, c, 3000);
    const r = await pay(b, c, { amount: 5000 });
    expect(r.body.allocations).toEqual([{ targetType: "initial_debt", saleId: null, initialDebtId: d.body.id, amount: 5000, openBefore: 10000, openAfter: 5000 }]);
    const l = await ledger(b, c);
    expect(l.initials[0].openBalance).toBe(5000);
    expect(openOf(l, s)).toBe(3000);
    // R7
    const c2 = await customer(b, "Con saldo");
    expect((await pay(b, c2, { amount: 700 })).body.creditBalanceAfter).toBe(700);
    await post(b, `/v1/customers/${c2}/initial-debts`, { amount: 1000 });
    const after = await get(b, `/v1/customers/${c2}`);
    expect([after.body.debt, after.body.creditBalance]).toEqual([1000, 700]);
    await invariants(b);
  });

  it("T5: abono to a specific sale B with an older A → B first, A intact; R2 overflow fifo/credit", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const A = await fiada(b, c, 3000);
    const B = await fiada(b, c, 2000);
    const r = await pay(b, c, { amount: 1500, target: { mode: "sale", saleId: B } });
    expect(r.status).toBe(201);
    expect(r.body.allocations).toEqual([{ targetType: "sale", saleId: B, initialDebtId: null, amount: 1500, openBefore: 2000, openAfter: 500 }]);
    const over = await pay(b, c, { amount: 1000, target: { mode: "sale", saleId: B }, overflow: "credit" });
    expect(over.body.allocations.map((a: { targetType: string; amount: number }) => [a.targetType, a.amount])).toEqual([["sale", 500], ["credit", 500]]);
    const l = await ledger(b, c);
    expect([openOf(l, A), openOf(l, B), l.customer.creditBalance]).toEqual([3000, 0, 500]);
    expect(l.payments[0].requestedTarget).toEqual({ mode: "sale", saleId: B, overflow: "fifo" });
    await invariants(b);
  });

  it("T6 (R4): abono 6000 with debt 5000 → 201, debt 0, saldo a favor 1000, debt_collect 6000 (no 409 ABONO_EXCEEDS_DEBT)", async () => {
    const b = await newBiz();
    const c = await customer(b);
    await fiada(b, c, 5000);
    const r = await pay(b, c, { amount: 6000 });
    expect(r.status).toBe(201);
    expect([r.body.debtAfter, r.body.creditBalanceAfter]).toEqual([0, 1000]);
    expect(r.body.allocations.at(-1)).toMatchObject({ targetType: "credit", amount: 1000 });
    const move = await prisma.cashMove.findFirstOrThrow({ where: { businessId: b.biz, refId: r.body.id } });
    expect([move.kind, move.amount]).toEqual(["debt_collect", 6000n]);
    // No debt at all → everything to credit
    const c2 = await customer(b, "Sin deuda");
    const r2 = await pay(b, c2, { amount: 800 });
    expect(r2.status).toBe(201);
    expect(r2.body.allocations).toEqual([{ targetType: "credit", saleId: null, initialDebtId: null, amount: 800, openBefore: null, openAfter: null }]);
    await invariants(b);
  });

  it("T7/T8: split A 1000 + B 1000 → two rows same groupId; split above A's open → 422 ALLOCATION_INVALID, nothing written", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const A = await fiada(b, c, 3000);
    const B = await fiada(b, c, 2000);
    const r = await pay(b, c, { amount: 2000, target: { mode: "split", targets: [{ saleId: A, amount: 1000 }, { saleId: B, amount: 1000 }] } });
    expect(r.status).toBe(201);
    const rows = await prisma.debtAllocation.findMany({ where: { sourceId: r.body.id } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((x) => x.groupId)).size).toBe(1);
    const before = await prisma.customerPayment.count({ where: { businessId: b.biz } });
    const bad = await pay(b, c, { amount: 5000, target: { mode: "split", targets: [{ saleId: A, amount: 2500 }] } });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("ALLOCATION_INVALID");
    const tooMuch = await pay(b, c, { amount: 500, target: { mode: "split", targets: [{ saleId: A, amount: 1000 }] } });
    expect(tooMuch.status).toBe(422);
    expect(await prisma.customerPayment.count({ where: { businessId: b.biz } })).toBe(before);
    const malformed = await pay(b, c, { amount: 500, target: { mode: "nope" } });
    expect(malformed.status).toBe(400);
    await invariants(b);
  });

  it("T9/T10/T26: returns — own sale first, then FIFO; rest by remainder (credit / refund / missing → 422)", async () => {
    const b = await newBiz();
    const c = await customer(b);
    // T9: partial return on an open fiada → its own sale
    const older = await fiada(b, c, 2000);
    const own = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 3, unitPrice: 1000 }], paymentKind: "credit", customerId: c, amountReceived: 0 });
    const lineId = own.body.lines[0].id;
    const t9 = await post(b, `/v1/sales/${own.body.id}/returns`, { lines: [{ saleLineId: lineId, qty: 1 }] });
    expect(t9.status).toBe(201);
    expect(t9.body.allocations).toEqual([{ targetType: "sale", saleId: own.body.id, initialDebtId: null, amount: 1000 }]);
    let l = await ledger(b, c);
    expect([openOf(l, older), openOf(l, own.body.id)]).toEqual([2000, 2000]);

    // T10: settle `own` fully by a specific abono, then return the rest (2000):
    // own open 0 → older (FIFO) gets 2000; nothing left.
    await pay(b, c, { amount: 2000, target: { mode: "sale", saleId: own.body.id } });
    const t10 = await post(b, `/v1/sales/${own.body.id}/returns`, { lines: [{ saleLineId: lineId, qty: 2 }] });
    expect(t10.status).toBe(201);
    expect(t10.body.allocations).toEqual([{ targetType: "sale", saleId: older, initialDebtId: null, amount: 2000 }]);
    l = await ledger(b, c);
    expect([openOf(l, older), l.customer.debt]).toEqual([0, 0]);

    // T10 exact: fiada 3000 settled by abono + other open 2000; total return 3000.
    const c2 = await customer(b, "T10");
    const s3 = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 3, unitPrice: 1000 }], paymentKind: "credit", customerId: c2, amountReceived: 0 });
    await pay(b, c2, { amount: 3000 });
    const other = await fiada(b, c2, 2000);
    const ret = (remainder?: string, key?: string) =>
      post(b, `/v1/sales/${s3.body.id}/returns`, { lines: [{ saleLineId: s3.body.lines[0].id, qty: 3 }], ...(remainder ? { remainder } : {}) }, key);
    const missing = await ret();
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("REMAINDER_CHOICE_REQUIRED");
    const ok = await ret("credit");
    expect(ok.status).toBe(201);
    expect([ok.body.debtReduced, ok.body.refundAmount, ok.body.toCredit, ok.body.remainderMode]).toEqual([2000, 0, 1000, "credit"]);
    expect(ok.body.allocations).toEqual([
      { targetType: "sale", saleId: other, initialDebtId: null, amount: 2000 },
      { targetType: "credit", saleId: null, initialDebtId: null, amount: 1000 },
    ]);
    const c2l = await ledger(b, c2);
    expect([c2l.customer.debt, c2l.customer.creditBalance]).toEqual([0, 1000]);
    await invariants(b);
  });

  it("T25/T31: return of a paid sale with no other debt — refund / credit / missing 422 / offline missing → credit + needs_review", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const sale = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 4, unitPrice: 1000 }], paymentKind: "paid", customerId: c, amountReceived: 4000, method: "Nequi" });
    const line = sale.body.lines[0].id;
    const ret = (body: object, headers: Record<string, string> = {}) => post(b, `/v1/sales/${sale.body.id}/returns`, { lines: [{ saleLineId: line, qty: 1 }], ...body }, randomUUID(), headers);
    const missing = await ret({});
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("REMAINDER_CHOICE_REQUIRED");
    const refund = await ret({ remainder: "refund" });
    expect([refund.status, refund.body.refundAmount, refund.body.method, refund.body.remainderMode]).toEqual([201, 1000, "Nequi", "refund"]);
    const out = await prisma.cashMove.findFirstOrThrow({ where: { refId: refund.body.id } });
    expect([out.kind, out.direction, out.method]).toEqual(["devolucion", "out", "Nequi"]);
    const credit = await ret({ remainder: "credit" });
    expect([credit.body.refundAmount, credit.body.toCredit]).toEqual([0, 1000]);
    expect(await prisma.cashMove.count({ where: { refId: credit.body.id } })).toBe(0);
    const offline = await ret({}, { "X-Offline-Replay": "true" });
    expect(offline.status).toBe(201);
    expect([offline.body.toCredit, offline.body.needsReview, offline.body.remainderMode]).toEqual([1000, true, "credit"]);
    expect(await prisma.cashMove.count({ where: { refId: offline.body.id } })).toBe(0);
    expect((await get(b, `/v1/customers/${c}`)).body.creditBalance).toBe(2000);
    // walk-in sale: rest is always a refund, no remainder needed (unchanged)
    const walk = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: 500 }], paymentKind: "paid", amountReceived: 500, method: "Efectivo" });
    const wr = await post(b, `/v1/sales/${walk.body.id}/returns`, { lines: [{ saleLineId: walk.body.lines[0].id, qty: 1 }] });
    expect([wr.status, wr.body.refundAmount, wr.body.toCredit]).toEqual([201, 500, 0]);
    await invariants(b);
  });

  it("T11: two parallel FIFO abonos for the full debt → one allocates all, the other goes to credit (no 409)", async () => {
    const b = await newBiz();
    const c = await customer(b);
    await fiada(b, c, 3000);
    const [r1, r2] = await Promise.all([pay(b, c, { amount: 3000 }), pay(b, c, { amount: 3000 })]);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const credits = [r1.body, r2.body].map((x) => x.allocations.filter((a: { targetType: string }) => a.targetType === "credit").length).sort();
    expect(credits).toEqual([0, 1]);
    const cu = (await get(b, `/v1/customers/${c}`)).body;
    expect([cu.debt, cu.creditBalance]).toEqual([0, 3000]);
    await invariants(b);
  });

  it("T12: three consecutive abonos of 1000 over three sales → FIFO accumulates", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const ids = [await fiada(b, c, 1000), await fiada(b, c, 1000), await fiada(b, c, 1000)];
    const hit: string[] = [];
    for (let i = 0; i < 3; i++) hit.push((await pay(b, c, { amount: 1000 })).body.allocations[0].saleId);
    expect(hit).toEqual(ids);
    await invariants(b);
  });

  it("T13/T14/C02/C03: same key ×5 → 1 payment, identical allocations; other target → 422; omitted ≡ {mode:fifo}; other occurredAt → 201", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const A = await fiada(b, c, 3000);
    await fiada(b, c, 2000);
    const key = randomUUID();
    const res = await Promise.all(Array.from({ length: 5 }, () => pay(b, c, { amount: 4000 }, key)));
    expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(res.map((r) => r.body.id)).size).toBe(1);
    expect(new Set(res.map((r) => JSON.stringify(r.body.allocations))).size).toBe(1);
    expect(new Set(res.map((r) => JSON.stringify([r.body.debtBefore, r.body.debtAfter]))).size).toBe(1);
    expect(await prisma.customerPayment.count({ where: { businessId: b.biz } })).toBe(1);
    // same key + explicit default target → same hash (201 replay)
    const explicit = await pay(b, c, { amount: 4000, target: { mode: "fifo" } }, key);
    expect([explicit.status, explicit.body.id]).toEqual([201, res[0]!.body.id]);
    // C03: same key + other occurredAt → 201 (occurredAt not in the hash)
    const occ = await pay(b, c, { amount: 4000, occurredAt: new Date(Date.now() - 3600_000).toISOString() }, key);
    expect([occ.status, occ.body.id]).toEqual([201, res[0]!.body.id]);
    // T14
    const other = await pay(b, c, { amount: 4000, target: { mode: "sale", saleId: A } }, key);
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe("IDEMPOTENCY_MISMATCH");
    const overflow = await pay(b, c, { amount: 4000, target: { mode: "sale", saleId: A }, overflow: "credit" }, randomUUID());
    expect(overflow.status).toBe(201);
    await invariants(b);
  });

  it("C02.1: a legacy pre-C04 row (NULL hash, no requested_target) still replays with the 4-field hash", async () => {
    const b = await newBiz();
    const c = await customer(b);
    await fiada(b, c, 5000);
    const key = randomUUID();
    expect((await pay(b, c, { amount: 1000, note: "x" }, key)).status).toBe(201);
    await prisma.$executeRaw`UPDATE customer_payments SET payload_hash = NULL, requested_target = NULL, allocation_result = NULL WHERE request_id = ${key}::uuid`;
    const again = await pay(b, c, { amount: 1000, note: "x" }, key);
    expect(again.status).toBe(201);
    expect(again.body.allocations).toHaveLength(1);
    const mismatch = await pay(b, c, { amount: 1000, note: "y" }, key);
    expect(mismatch.status).toBe(422);
    await invariants(b);
  });

  it("T15/T28/T27: saldo a favor — apply to a new fiada (pair, no cash), sale without flag informs creditAvailable, sale with applyCredit", async () => {
    const b = await newBiz();
    const c = await customer(b);
    await pay(b, c, { amount: 1000 }); // all credit
    const s = await fiada(b, c, 1500);
    const cashBefore = await prisma.cashMove.count({ where: { businessId: b.biz } });
    const key = randomUUID();
    const ap = await post(b, `/v1/customers/${c}/credit/apply`, { target: { mode: "sale", saleId: s } }, key);
    expect(ap.status).toBe(201);
    expect([ap.body.creditApplied, ap.body.debtAfter, ap.body.creditBalanceAfter]).toEqual([1000, 500, 0]);
    const pair = await prisma.debtAllocation.findMany({ where: { groupId: key } });
    expect(pair.map((x) => [x.targetType, x.amount, x.mode]).sort()).toEqual([["credit", -1000n, "credit_apply"], ["sale", 1000n, "credit_apply"]]);
    expect(openOf(await ledger(b, c), s)).toBe(500);
    expect(await prisma.cashMove.count({ where: { businessId: b.biz } })).toBe(cashBefore);
    // replay same key → same result, no new rows
    const again = await post(b, `/v1/customers/${c}/credit/apply`, { target: { mode: "sale", saleId: s } }, key);
    expect([again.status, again.body.creditApplied]).toEqual([201, 1000]);
    expect(await prisma.debtAllocation.count({ where: { groupId: key } })).toBe(2);
    // CREDIT_INSUFFICIENT
    const none = await post(b, `/v1/customers/${c}/credit/apply`, { amount: 100 });
    expect([none.status, none.body.error?.code]).toEqual([422, "CREDIT_INSUFFICIENT"]);

    // T28: no flag → nothing applied, creditAvailable informed
    const c2 = await customer(b, "Con saldo");
    await pay(b, c2, { amount: 1000 });
    const noFlag = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: 1500 }], paymentKind: "credit", customerId: c2, amountReceived: 0 });
    expect([noFlag.body.creditApplied, noFlag.body.creditAvailable]).toEqual([0, 1000]);
    expect(openOf(await ledger(b, c2), noFlag.body.id)).toBe(1500);

    // T27 fiada: 1500 with 1000 credit → open 500
    const c3 = await customer(b, "T27 fiada");
    await pay(b, c3, { amount: 1000 });
    const f = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: 1500 }], paymentKind: "credit", customerId: c3, amountReceived: 0, applyCredit: true });
    expect([f.status, f.body.creditApplied, f.body.credit]).toEqual([201, 1000, 1500]);
    expect(openOf(await ledger(b, c3), f.body.id)).toBe(500);
    // T27 contado: 1500, received 500, applyCredit → no cash for the 1000
    const c4 = await customer(b, "T27 contado");
    await pay(b, c4, { amount: 1000 });
    const paid = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: 1500 }], paymentKind: "paid", customerId: c4, amountReceived: 500, method: "Efectivo", applyCredit: true });
    expect([paid.status, paid.body.amountReceived, paid.body.creditApplied, paid.body.paymentKind]).toEqual([201, 500, 1000, "partial"]);
    const saleMoves = await prisma.cashMove.findMany({ where: { refId: paid.body.id } });
    expect(saleMoves.map((m) => m.amount)).toEqual([500n]);
    const c4now = (await get(b, `/v1/customers/${c4}`)).body;
    expect([c4now.debt, c4now.creditBalance]).toEqual([0, 0]);
    expect(openOf(await ledger(b, c4), paid.body.id)).toBe(0);
    // paid without enough credit still needs the full amount
    const short = await post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: 1, unitPrice: 1500 }], paymentKind: "paid", customerId: c4, amountReceived: 500, method: "Efectivo" });
    expect(short.status).toBe(400);
    await invariants(b);
  });

  it("T16: balance-check ok on a healthy customer; ok:false with both figures when debt is altered in the test DB", async () => {
    const b = await newBiz();
    const c = await customer(b);
    await fiada(b, c, 3000);
    await pay(b, c, { amount: 1000 });
    const ok = await get(b, `/v1/customers/${c}/balance-check`);
    expect(ok.body).toEqual({ customerId: c, stored: { debt: 2000, creditBalance: 0 }, reconstructed: { debt: 2000, creditBalance: 0 }, ok: true });
    await prisma.$executeRaw`UPDATE customers SET debt = 2500 WHERE id = ${c}::uuid`;
    const bad = await get(b, `/v1/customers/${c}/balance-check`);
    expect(bad.body).toMatchObject({ stored: { debt: 2500 }, reconstructed: { debt: 2000 }, ok: false });
  });

  it("T17/T18/T19/T23/T30: saleRequestId, settled-by-another-device (adjusted), closed day, isolation and replay scope", async () => {
    const b = await newBiz();
    const c = await customer(b);
    const older = await fiada(b, c, 1000);
    const saleKey = randomUUID();
    const target = await fiada(b, c, 2000, saleKey);
    // T17: abono pointing at the offline sale's requestId
    const t17 = await pay(b, c, { amount: 500, target: { mode: "sale", saleRequestId: saleKey } }, undefined, { "X-Offline-Replay": "true" });
    expect(t17.status).toBe(201);
    expect(t17.body.allocations[0]).toMatchObject({ saleId: target, amount: 500 });
    // settle target from "another device"
    await pay(b, c, { amount: 1500, target: { mode: "sale", saleId: target } });
    // T18: replayed abono for the settled sale → 201 adjusted, applied to the oldest
    const t18 = await pay(b, c, { amount: 400, target: { mode: "sale", saleId: target } }, undefined, { "X-Offline-Replay": "true" });
    expect([t18.status, t18.body.adjusted]).toEqual([201, true]);
    expect(t18.body.allocations).toEqual([{ targetType: "sale", saleId: older, initialDebtId: null, amount: 400, openBefore: 1000, openAfter: 600 }]);
    expect((await prisma.customerPayment.findUniqueOrThrow({ where: { id: t18.body.id } })).allocationAdjusted).toBe(true);
    const l = await ledger(b, c);
    expect(l.payments.find((p: { id: string }) => p.id === t18.body.id).adjusted).toBe(true);

    // T23/T30: other customer's / other business's sale → 422, nothing written, even with the header
    const c2 = await customer(b, "Otro");
    const foreign = await fiada(b, c2, 900);
    const b2 = await newBiz();
    const c3 = await customer(b2, "Ajeno");
    const alien = await fiada(b2, c3, 900);
    const count = await prisma.customerPayment.count();
    for (const saleId of [foreign, alien, randomUUID()]) {
      const r = await pay(b, c, { amount: 100, target: { mode: "sale", saleId } }, undefined, { "X-Offline-Replay": "true" });
      expect([r.status, r.body.error.code]).toEqual([422, "ALLOCATION_INVALID"]);
    }
    const split = await pay(b, c, { amount: 100, target: { mode: "split", targets: [{ saleId: alien, amount: 100 }] } });
    expect(split.status).toBe(422);
    expect(await prisma.customerPayment.count()).toBe(count);
    // T30 date part: C03 house style → 400 VALIDATION, header does not relax it
    const old = await pay(b, c, { amount: 100, occurredAt: new Date(Date.now() - 31 * 86400_000).toISOString() }, undefined, { "X-Offline-Replay": "true" });
    expect([old.status, old.body.error.code]).toEqual([400, "VALIDATION"]);

    // T19: day closed → abono accepted and allocated (C01 decision 1)
    const session = (await get(b, "/v1/cash/today")).body.session;
    expect((await post(b, `/v1/cash/sessions/${session.id}/close`, { countedEfectivo: 0 })).status).toBe(201);
    const t19 = await pay(b, c, { amount: 600, occurredAt: new Date(Date.now() - 3600_000).toISOString() }, undefined, { "X-Offline-Replay": "true" });
    expect(t19.status).toBe(201);
    expect(t19.body.allocations).toEqual([{ targetType: "sale", saleId: older, initialDebtId: null, amount: 600, openBefore: 600, openAfter: 0 }]);
    await invariants(b);
    await invariants(b2);
  });

  it("T29/T32: credit/refund (staff 403 / owner without caja 409 / owner with caja → out reembolso_saldo) and adjusted review (owner / staff 403)", async () => {
    const b = await newBiz(false);
    const staffId = randomUUID();
    const email = `c04-staff-${staffId}@test.co`;
    await prisma.user.create({ data: { id: staffId, email, passwordHash: await bcrypt.hash("password12", 12) } });
    await prisma.businessMembership.create({ data: { id: randomUUID(), businessId: b.biz, userId: staffId, role: "staff" } });
    const login = await api().post("/v1/auth/login").send({ email, password: "password12" });
    const staff = { token: login.body.accessToken as string, biz: b.biz };
    const c = await customer(b);
    await pay(b, c, { amount: 2000 });
    expect((await post(staff, `/v1/customers/${c}/credit/refund`, { amount: 500, method: "Efectivo" })).status).toBe(403);
    const noCaja = await post(b, `/v1/customers/${c}/credit/refund`, { amount: 500, method: "Efectivo" });
    expect([noCaja.status, noCaja.body.error.code]).toEqual([409, "CLOSED_DAY"]);
    expect((await post(b, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    const key = randomUUID();
    const ok = await post(b, `/v1/customers/${c}/credit/refund`, { amount: 500, method: "Efectivo" }, key);
    expect([ok.status, ok.body.kind, ok.body.amount]).toEqual([201, "reembolso_saldo", 500]);
    const move = await prisma.cashMove.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect([move.direction, move.kind]).toEqual(["out", "reembolso_saldo"]);
    expect((await post(b, `/v1/customers/${c}/credit/refund`, { amount: 500, method: "Efectivo" }, key)).body.id).toBe(ok.body.id);
    expect((await get(b, `/v1/customers/${c}`)).body.creditBalance).toBe(1500);
    const tooMuch = await post(b, `/v1/customers/${c}/credit/refund`, { amount: 5000, method: "Efectivo" });
    expect([tooMuch.status, tooMuch.body.error.code]).toEqual([422, "CREDIT_INSUFFICIENT"]);

    // T32
    const A = await fiada(b, c, 1000);
    const B = await fiada(b, c, 1000);
    // credit 1500 is not auto-applied (R5); settle B, then ask for B again → adjusted
    await pay(b, c, { amount: 1000, target: { mode: "sale", saleId: B } });
    const adj = await pay(b, c, { amount: 300, target: { mode: "sale", saleId: B } });
    expect(adj.body.adjusted).toBe(true);
    expect(adj.body.allocations[0].saleId).toBe(A);
    const url = `/v1/customers/${c}/payments/${adj.body.id}/review`;
    expect((await post(staff, url, {})).status).toBe(403);
    const rev = await post(b, url, {});
    expect(rev.status).toBe(201);
    expect(rev.body.adjustedReviewedAt).toBeTruthy();
    const row = await prisma.customerPayment.findUniqueOrThrow({ where: { id: adj.body.id } });
    expect(row.adjustedReviewedBy).toBe(b.userId);
    expect(row.adjustedReviewedAt).toBeTruthy();
    expect((await get(staff as Biz, `/v1/customers/${c}/balance-check`)).status).toBe(403);
    await invariants(b);
  });

  it("wipe: business reset deletes debt_allocations too", async () => {
    const b = await newBiz();
    const c = await customer(b);
    await fiada(b, c, 1000);
    await pay(b, c, { amount: 1500 });
    expect(await prisma.debtAllocation.count({ where: { businessId: b.biz } })).toBe(2);
    const r = await api().delete("/v1/business/data").set(auth(b));
    expect(r.status).toBe(200);
    expect(r.body.deleted.debtAllocations).toBe(2);
    expect(await prisma.debtAllocation.count({ where: { businessId: b.biz } })).toBe(0);
  });
});
