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
 * C09-PR1 — per-business sequences (SPEC-C09 §3.1, decisions 5/13/26):
 * sales DC-000001, abonos DC-P-000001, reversos DC-R-000001. T1, T2, T24 + I-C6.
 * Embedded Postgres, fictitious data only.
 */
describe("C09-PR1 business sequences", () => {
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
    const owner = await seedOwner(app, `c09-${seq}@test.co`, `C09-${seq}`);
    const b: Biz = { token: owner.accessToken, biz: owner.business.id, productId: "" };
    const p = await post(b, "/v1/products", { name: "Bombón", price: 1000, stock: 10_000, avgCost: 400 });
    expect(p.status).toBe(201);
    b.productId = p.body.id;
    expect((await post(b, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    return b;
  }
  const api = () => request(app.getHttpServer());
  const auth = (b: Biz) => ({ Authorization: `Bearer ${b.token}`, "X-Business-Id": b.biz });
  const post = (b: Biz, url: string, body: object, key: string = randomUUID()) =>
    api().post(url).set(auth(b)).set("Idempotency-Key", key).send(body);
  const get = (b: Biz, url: string) => api().get(url).set(auth(b));
  const saleBody = (b: Biz, extra: object = {}) => ({
    lines: [{ productId: b.productId, qty: 1, unitPrice: 1000 }],
    paymentKind: "paid",
    amountReceived: 1000,
    method: "Efectivo",
    ...extra,
  });
  async function customer(b: Biz, name = "Ana") {
    const r = await post(b, "/v1/customers", { name });
    expect(r.status).toBe(201);
    return r.body.id as string;
  }

  it("T1: 3 sales in business A → DC-000001..3; 1 in B → DC-000001; detail and list carry the number", async () => {
    const a = await newBiz();
    const b = await newBiz();
    const nums: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await post(a, "/v1/sales", saleBody(a));
      expect(r.status).toBe(201);
      nums.push(r.body.number);
    }
    expect(nums).toEqual(["DC-000001", "DC-000002", "DC-000003"]);
    const rb = await post(b, "/v1/sales", saleBody(b));
    expect(rb.body.number).toBe("DC-000001");
    const detail = await get(a, `/v1/sales/${(await prisma.sale.findFirstOrThrow({ where: { businessId: a.biz, number: 2 } })).id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.number).toBe("DC-000002");
    const list = await get(a, "/v1/sales");
    expect(list.status).toBe(200);
    const rows = (Array.isArray(list.body) ? list.body : list.body.items) as Array<{ number: string }>;
    expect(rows.map((s) => s.number).sort()).toEqual(["DC-000001", "DC-000002", "DC-000003"]);
  });

  it("T2 / I-C6: 5 concurrent sales get unique consecutive numbers; replay keeps its number; a failed sale leaves no gap", async () => {
    const a = await newBiz();
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(a, "/v1/sales", saleBody(a))));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(rs.map((r) => r.body.number).sort()).toEqual(["DC-000001", "DC-000002", "DC-000003", "DC-000004", "DC-000005"]);
    // T7-style replay: same key → same sale, same number, sequence does not move.
    const key = randomUUID();
    const first = await post(a, "/v1/sales", saleBody(a), key);
    const again = await post(a, "/v1/sales", saleBody(a), key);
    expect([first.body.number, again.body.number, again.body.id]).toEqual(["DC-000006", "DC-000006", first.body.id]);
    // A sale rejected inside the transaction (unknown product) consumes nothing.
    const bad = await post(a, "/v1/sales", { ...saleBody(a), lines: [{ productId: randomUUID(), qty: 1, unitPrice: 1000 }] });
    expect(bad.status).toBe(404);
    expect((await post(a, "/v1/sales", saleBody(a))).body.number).toBe("DC-000007");
    const stored = await prisma.sale.findMany({ where: { businessId: a.biz }, orderBy: { number: "asc" }, select: { number: true } });
    expect(stored.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("T24: 2 abonos and 1 reverso in A → DC-P-000001..2 and DC-R-000001; corregir numbers the new abono DC-P-000003 and DC-R-000002", async () => {
    const a = await newBiz();
    const ana = await customer(a, "Ana");
    const beto = await customer(a, "Beto");
    expect((await post(a, "/v1/sales", { lines: [{ productId: a.productId, qty: 5, unitPrice: 1000 }], paymentKind: "credit", customerId: ana, amountReceived: 0 })).body.number).toBe("DC-000001");
    const k1 = randomUUID();
    const p1 = await post(a, `/v1/customers/${ana}/payments`, { amount: 1000, method: "Efectivo" }, k1);
    const p2 = await post(a, `/v1/customers/${ana}/payments`, { amount: 500, method: "Nequi" });
    expect([p1.status, p1.body.number, p2.body.number]).toEqual([201, "DC-P-000001", "DC-P-000002"]);
    const replay = await post(a, `/v1/customers/${ana}/payments`, { amount: 1000, method: "Efectivo" }, k1);
    expect([replay.body.id, replay.body.number]).toEqual([p1.body.id, "DC-P-000001"]);
    const rv = await post(a, `/v1/customers/${ana}/payments/${p2.body.id}/reverse`, { reasonCode: "duplicado" });
    expect([rv.status, rv.body.number]).toEqual([201, "DC-R-000001"]);
    const c = await post(a, `/v1/customers/${ana}/payments/${p1.body.id}/correct`, {
      reasonCode: "cliente_equivocado",
      replacement: { customerId: beto, amount: 1000, method: "Efectivo", requestId: randomUUID() },
    });
    expect(c.status).toBe(201);
    expect([c.body.number, c.body.replacementPayment.number]).toEqual(["DC-R-000002", "DC-P-000003"]);
    // Owner ledger shows the abono numbers.
    const l = await get(a, `/v1/customers/${ana}/ledger`);
    expect(l.status).toBe(200);
    expect((l.body.payments as Array<{ number: string }>).map((p) => p.number).sort()).toEqual(["DC-P-000001", "DC-P-000002"]);
    // Sequences are per business and per kind.
    const b = await newBiz();
    const cb = await customer(b, "Ana");
    expect((await post(b, `/v1/customers/${cb}/payments`, { amount: 100, method: "Efectivo" })).body.number).toBe("DC-P-000001");
    const rows = await prisma.businessSequence.findMany({ where: { businessId: a.biz }, orderBy: { kind: "asc" } });
    expect(rows.map((r) => [r.kind, Number(r.next)])).toEqual([
      ["sale", 2],
      ["payment", 4],
      ["reversal", 3],
    ]);
  });

  it("wipe keeps the sequences: numbers are never reused after a business data reset", async () => {
    const a = await newBiz();
    expect((await post(a, "/v1/sales", saleBody(a))).body.number).toBe("DC-000001");
    const reset = await api().delete("/v1/business/data").set(auth(a));
    expect(reset.status).toBe(200);
    const p = await post(a, "/v1/products", { name: "Bombón", price: 1000, stock: 100, avgCost: 400 });
    a.productId = p.body.id;
    expect((await post(a, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    expect((await post(a, "/v1/sales", saleBody(a))).body.number).toBe("DC-000002");
  });
});
