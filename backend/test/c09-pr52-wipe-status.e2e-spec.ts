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
jest.setTimeout(120000);

/**
 * C09-PR5.2 (Tester C09-PR5-T01) — receipt status is DERIVED and must not
 * change when «Borrar datos» (DELETE /v1/business/data) removes `reversals`
 * and `debt_allocations`: it has to come from the insert-only receipts that
 * survive the wipe. Same status AND `related` before / after, in the owner
 * detail, the portal detail and the public verify. Embedded Postgres,
 * fictitious data only.
 */
describe("C09-PR5.2 derived receipt status survives the business wipe (T01)", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  const PIN = "482915";

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
  const api = () => request(app.getHttpServer());
  const auth = (b: { token: string; biz: string }) => ({ Authorization: `Bearer ${b.token}`, "X-Business-Id": b.biz });
  const post = (b: Biz, url: string, body: object, key: string = randomUUID()) =>
    api().post(url).set(auth(b)).set("Idempotency-Key", key).send(body);
  async function newBiz(): Promise<Biz> {
    seq += 1;
    const owner = await seedOwner(app, `c09r52-${seq}@test.co`, `Tienda Wipe ${seq}`);
    const b: Biz = { token: owner.accessToken, biz: owner.business.id, productId: "" };
    const p = await post(b, "/v1/products", { name: "Bombón", price: 1000, stock: 10_000, avgCost: 400 });
    expect(p.status).toBe(201);
    b.productId = p.body.id;
    expect((await post(b, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    return b;
  }
  async function customer(b: Biz, name: string) {
    const r = await post(b, "/v1/customers", { name });
    expect(r.status).toBe(201);
    expect((await api().post(`/v1/customers/${r.body.id}/pin`).set(auth(b)).send({ pin: PIN })).status).toBe(201);
    const login = await api().post("/v1/customer-access/login").send({ code: r.body.code, pin: PIN, businessId: b.biz });
    expect(login.status).toBe(201);
    return { id: r.body.id as string, token: login.body.accessToken as string };
  }
  const ok = async (p: Promise<request.Response> | request.Test) => {
    const r = await p;
    expect([r.status, r.body?.error?.code]).toEqual([201, undefined]);
    return r;
  };
  const fiada = (b: Biz, customerId: string, total: number) =>
    post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: total / 1000, unitPrice: 1000 }], paymentKind: "credit", customerId, amountReceived: 0 });
  const paid = (b: Biz, total: number) =>
    post(b, "/v1/sales", { lines: [{ productId: b.productId, qty: total / 1000, unitPrice: 1000 }], paymentKind: "paid", amountReceived: total, method: "Efectivo" });
  const pay = (b: Biz, customerId: string, amount: number) => post(b, `/v1/customers/${customerId}/payments`, { amount, method: "Efectivo" });

  type Rel = { number: string };
  type View = { owner: [number, string, string[]]; portal: [number, string, string[]] | null; verify: [number, string] };
  async function views(b: Biz, portalTokens: Map<string, string>): Promise<Record<string, View>> {
    const rows = await prisma.receipt.findMany({ where: { businessId: b.biz }, orderBy: { number: "asc" } });
    const out: Record<string, View> = {};
    for (const r of rows) {
      const o = await api().get(`/v1/receipts/${r.id}`).set(auth(b));
      const v = await api().get(`/v1/receipts/verify/${r.verifyCode}`);
      const t = r.customerId ? portalTokens.get(r.customerId) : undefined;
      const p = t ? await api().get(`/v1/customer/me/receipts/${r.id}`).set("Authorization", `Bearer ${t}`) : null;
      const rel = (x: { related?: Rel[] }) => (x.related ?? []).map((y) => y.number).sort();
      out[r.number] = {
        owner: [o.status, o.body.status, rel(o.body)],
        portal: p ? [p.status, p.body.status, rel(p.body)] : null,
        verify: [v.status, v.body.status],
      };
    }
    return out;
  }

  it("Tester's exact scenario: status and related identical before/after the wipe in owner, portal and verify", async () => {
    const b = await newBiz();
    const ana = await customer(b, "Ana WS");
    const beto = await customer(b, "Beto WS");
    await customer(b, "Cris WS");
    await ok(fiada(b, ana.id, 5000)); // DC-000001
    await ok(pay(b, ana.id, 1000)); // DC-P-000001
    const p2 = await ok(pay(b, ana.id, 700)); // DC-P-000002 → reversed
    await ok(post(b, `/v1/customers/${ana.id}/payments/${p2.body.id}/reverse`, { reasonCode: "duplicado" }));
    const p3 = await ok(pay(b, ana.id, 900)); // DC-P-000003 → corrected
    await ok(
      post(b, `/v1/customers/${ana.id}/payments/${p3.body.id}/correct`, {
        reasonCode: "monto_equivocado",
        replacement: { customerId: ana.id, amount: 800, method: "Efectivo", requestId: randomUUID() },
      }),
    );
    const s2 = await ok(paid(b, 2000)); // DC-000002 → voided (internal receipt)
    await ok(post(b, `/v1/sales/${s2.body.id}/void`, { reasonCode: "error_digitacion" }));
    const p4 = await ok(pay(b, beto.id, 800)); // DC-P-000005
    await ok(fiada(b, beto.id, 2000)); // DC-000003
    await ok(post(b, `/v1/customers/${beto.id}/credit/apply`, {})); // DC-I-000001
    await ok(post(b, `/v1/customers/${beto.id}/payments/${p4.body.id}/reverse`, { reasonCode: "duplicado" })); // DC-I- fully compensated

    const tokens = new Map([
      [ana.id, ana.token],
      [beto.id, beto.token],
    ]);
    const before = await views(b, tokens);
    const st = (n: string) => before[n]!.owner[1];
    // The scenario really has «anulado» receipts (Tester's list of 8) and the rest «vigente».
    const voided = ["DC-000002", "DC-I-000001", "DC-P-000002", "DC-P-000002/D1", "DC-P-000003", "DC-P-000003/D1", "DC-P-000005", "DC-P-000005/D1"];
    for (const n of voided) expect([n, st(n)]).toEqual([n, "anulado"]);
    for (const [n, v] of Object.entries(before)) {
      if (!voided.includes(n)) expect([n, v.owner[1]]).toEqual([n, "vigente"]);
      // One derivation: the three views agree before the wipe.
      expect([n, v.verify]).toEqual([n, [200, v.owner[1]]]);
      if (v.portal) expect([n, v.portal]).toEqual([n, v.owner]);
    }
    expect(before["DC-I-000001"]!.owner[2]).toEqual(expect.arrayContaining(["DC-R-000004"]));

    expect((await api().delete("/v1/business/data").set(auth(b))).status).toBe(200);
    // What the wipe removed: the derivation can no longer lean on these tables.
    expect(await prisma.reversal.count({ where: { businessId: b.biz } })).toBe(0);
    expect(await prisma.debtAllocation.count({ where: { businessId: b.biz } })).toBe(0);
    expect(await prisma.customer.count({ where: { businessId: b.biz } })).toBe(0);
    expect(await prisma.receipt.count({ where: { businessId: b.biz } })).toBe(Object.keys(before).length);

    const after = await views(b, tokens);
    const ownerVerify = (m: Record<string, View>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { owner: v.owner, verify: v.verify }]));
    expect(ownerVerify(after)).toEqual(ownerVerify(before));
    // The portal: a session opened before the wipe either still reads the same thing or is gone (401), never a different status.
    for (const [n, v] of Object.entries(after)) {
      if (!v.portal) continue;
      if (v.portal[0] === 200) expect([n, v.portal]).toEqual([n, before[n]!.portal]);
      else expect([n, v.portal[0]]).toEqual([n, 401]);
    }
  });

  it("partial compensation (PR3.2) stays «vigente» after the wipe, with the same related DC-R-", async () => {
    const b = await newBiz();
    const ana = await customer(b, "Ana Parcial");
    await ok(pay(b, ana.id, 3000));
    const s = await ok(fiada(b, ana.id, 4000));
    const ap = await ok(post(b, `/v1/customers/${ana.id}/credit/apply`, {}));
    const iRef = ap.body.receipts[0] as { id: string; number: string };
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: s.body.id }, include: { lines: true } });
    await ok(post(b, `/v1/sales/${s.body.id}/returns`, { lines: [{ saleLineId: sale.lines[0]!.id, qty: 3 }], remainder: "credit" }));
    await ok(post(b, `/v1/sales/${s.body.id}/void`, { reasonCode: "error_digitacion" }));
    const tokens = new Map([[ana.id, ana.token]]);
    const before = await views(b, tokens);
    expect(before[iRef.number]!.owner[1]).toBe("vigente");
    expect(before[iRef.number]!.owner[2].some((n) => n.startsWith("DC-R-"))).toBe(true);
    expect(before["DC-000001"]!.owner[1]).toBe("anulado");
    expect((await api().delete("/v1/business/data").set(auth(b))).status).toBe(200);
    const after = await views(b, tokens);
    for (const n of Object.keys(before)) expect([n, after[n]!.owner, after[n]!.verify]).toEqual([n, before[n]!.owner, before[n]!.verify]);
  });
});
