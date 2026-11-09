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

/**
 * C09-PR4 — portal receipts and customer confirmations (SPEC-C09 §3.3, §5,
 * §6, §7; T11–T15, T25, T27; I-C4, I-C5). The portal is improved, not
 * replaced: same code + PIN login, same customer token. A confirmation is
 * extra evidence only and never changes balances. Fictitious data only.
 */
const PIN = "246813";
type Owner = Awaited<ReturnType<typeof seedOwner>>;

describe("C09-PR4 portal receipts and acknowledgements", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;

  beforeAll(async () => {
    pg = await startLocalPostgres();
    process.env.DATABASE_URL = pg.url;
    process.env.JWT_SECRET = "test-access-secret";
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.DISABLE_THROTTLE = "1";
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

  const api = () => request(app.getHttpServer());
  const admin = (o: Owner) => ({ Authorization: `Bearer ${o.accessToken}`, "X-Business-Id": o.business.id });
  const post = (o: Owner, url: string, body: object) => api().post(url).set(admin(o)).set("Idempotency-Key", randomUUID()).send(body);
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

  async function customer(o: Owner, name: string) {
    const c = await post(o, "/v1/customers", { name });
    expect(c.status).toBe(201);
    expect((await api().post(`/v1/customers/${c.body.id}/pin`).set(admin(o)).send({ pin: PIN })).status).toBe(201);
    return c.body as { id: string; code: string };
  }
  async function login(o: Owner, code: string) {
    const r = await api().post("/v1/customer-access/login").send({ code, pin: PIN, businessId: o.business.id });
    expect(r.status).toBe(201);
    return r.body.accessToken as string;
  }
  const me = (token: string, url: string) => api().get(url).set("Authorization", `Bearer ${token}`);
  const ack = (token: string, id: string, body: object) =>
    api().post(`/v1/customer/me/receipts/${id}/ack`).set("Authorization", `Bearer ${token}`).send(body);

  let a: Owner;
  let b: Owner;
  let productA: string;
  let ana: { id: string; code: string };
  let beto: { id: string; code: string };
  let anaB: { id: string; code: string };
  let anaToken: string;
  let betoToken: string;
  let anaBToken: string;
  let anaSale: { id: string; receipts: Array<{ id: string; kind: string; number: string }>; lines: Array<{ id: string }> };
  let anaPay: { id: string; receipts: Array<{ id: string; kind: string; number: string }> };
  let betoSaleReceipt: string;
  let internalReceipt: string;
  let anaBReceipt: string;

  beforeAll(async () => {
    a = await seedOwner(app, "c09p-a@test.co", "Tienda A");
    b = await seedOwner(app, "c09p-b@test.co", "Tienda B");
    for (const o of [a, b]) expect((await post(o, "/v1/cash/sessions", { openingFloat: 0 })).status).toBe(201);
    productA = (await post(a, "/v1/products", { name: "Bombón", price: 1000, stock: 100, avgCost: 400 })).body.id;
    const productB = (await post(b, "/v1/products", { name: "Chicle", price: 500, stock: 100, avgCost: 200 })).body.id;
    ana = await customer(a, "Ana");
    beto = await customer(a, "Beto");
    anaB = await customer(b, "Ana B");
    expect(anaB.code).toBe(ana.code); // same code in another business
    anaSale = (await post(a, "/v1/sales", { lines: [{ productId: productA, qty: 3, unitPrice: 1000 }], paymentKind: "credit", customerId: ana.id, amountReceived: 0 })).body;
    anaPay = (await post(a, `/v1/customers/${ana.id}/payments`, { amount: 1000, method: "Nequi" })).body;
    betoSaleReceipt = (await post(a, "/v1/sales", { lines: [{ productId: productA, qty: 2, unitPrice: 1000 }], paymentKind: "credit", customerId: beto.id, amountReceived: 0 })).body.receipts[0].id;
    internalReceipt = (await post(a, "/v1/sales", { lines: [{ productId: productA, qty: 1, unitPrice: 1000 }], paymentKind: "paid", amountReceived: 1000, method: "Efectivo" })).body.receipts[0].id;
    anaBReceipt = (await post(b, "/v1/sales", { lines: [{ productId: productB, qty: 2, unitPrice: 500 }], paymentKind: "credit", customerId: anaB.id, amountReceived: 0 })).body.receipts[0].id;
    anaToken = await login(a, ana.code);
    betoToken = await login(a, beto.code);
    anaBToken = await login(b, anaB.code);
  }, 180000);

  it("T11 / I-C4: the customer lists only their own receipts (no internal, no other customer, no other business)", async () => {
    const r = await me(anaToken, "/v1/customer/me/receipts");
    expect(r.status).toBe(200);
    const numbers = (r.body as Array<{ number: string }>).map((x) => x.number);
    expect([...numbers].sort()).toEqual(["DC-000001", "DC-P-000001", "DC-P-000001/D1"]);
    const ids = (r.body as Array<{ id: string }>).map((x) => x.id);
    expect(ids).not.toContain(betoSaleReceipt);
    expect(ids).not.toContain(internalReceipt);
    expect(ids).not.toContain(anaBReceipt);
    const item = (r.body as Array<Record<string, unknown>>).find((x) => x.number === "DC-000001")!;
    expect(item).toMatchObject({ kind: "sale", status: "vigente", ackState: "pending" });
    expect(item.hashPrefix).toMatch(/^[0-9a-f]{8}$/);
    expect(item).not.toHaveProperty("snapshot");
    // Business B's Ana (same code) sees only hers.
    const rb = await me(anaBToken, "/v1/customer/me/receipts");
    expect((rb.body as Array<{ id: string }>).map((x) => x.id)).toEqual([anaBReceipt]);
  });

  it("T12 / I-C4: another customer's, an internal or another business's receipt → 404 (read and ack)", async () => {
    for (const id of [betoSaleReceipt, internalReceipt, anaBReceipt, randomUUID()]) {
      expect((await me(anaToken, `/v1/customer/me/receipts/${id}`)).status).toBe(404);
      expect((await ack(anaToken, id, { kind: "acknowledged", receiptHash: "a".repeat(64) })).status).toBe(404);
    }
    // Same id, other business token.
    expect((await me(anaBToken, `/v1/customer/me/receipts/${anaSale.receipts[0]!.id}`)).status).toBe(404);
    // X-Business-Id on a portal request changes nothing.
    const forged = await me(anaToken, `/v1/customer/me/receipts/${anaBReceipt}`).set("X-Business-Id", b.business.id);
    expect(forged.status).toBe(404);
  });

  it("T27: the portal detail has the exact date and time (UTC-5), the snapshot, its hash and only own related receipts", async () => {
    const r = await me(anaToken, `/v1/customer/me/receipts/${anaPay.receipts[0]!.id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "payment", number: "DC-P-000001", status: "vigente", ackState: "pending", acks: [] });
    expect(r.body.issuedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}-05:00$/);
    expect(r.body.issuedAt).toBe(r.body.snapshot.createdAt);
    expect(r.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.hashPrefix).toBe(r.body.contentHash.slice(0, 8));
    expect(r.body.related).toEqual([{ id: anaPay.receipts[1]!.id, kind: "allocation", number: "DC-P-000001/D1" }]);
    expect(r.body).not.toHaveProperty("customerId");
  });

  it("T13 / I-C5: «Reconozco esto» creates one row, is idempotent for the same hash and changes no balance, caja or stock", async () => {
    const id = anaSale.receipts[0]!.id;
    const detail = (await me(anaToken, `/v1/customer/me/receipts/${id}`)).body;
    const state = async () => {
      const c = await prisma.customer.findUniqueOrThrow({ where: { id: ana.id }, select: { debt: true, creditBalance: true } });
      return {
        debt: String(c.debt),
        credit: String(c.creditBalance),
        cash: await prisma.cashMove.count({ where: { businessId: a.business.id } }),
        stock: (await prisma.product.findUniqueOrThrow({ where: { id: productA } })).stock,
        allocations: await prisma.debtAllocation.count({ where: { businessId: a.business.id } }),
        receipts: await prisma.receipt.count({ where: { businessId: a.business.id } }),
      };
    };
    const before = await state();
    const r = await ack(anaToken, id, { kind: "acknowledged", receiptHash: detail.contentHash });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ receiptId: id, kind: "acknowledged", receiptHash: detail.contentHash, channel: "portal", claimId: null, note: null });
    const again = await ack(anaToken, id, { kind: "acknowledged", receiptHash: detail.contentHash });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(r.body.id);
    expect(await state()).toEqual(before);
    expect(await prisma.receiptAcknowledgement.count({ where: { receiptId: id } })).toBe(1);
    const after = (await me(anaToken, `/v1/customer/me/receipts/${id}`)).body;
    expect(after.ackState).toBe("acknowledged");
    expect(after.acks).toEqual([{ kind: "acknowledged", receiptHash: detail.contentHash, note: null, at: r.body.at }]);
    expect(after.contentHash).toBe(detail.contentHash); // the receipt itself never changes
  });

  it("T14 (partial until C08-PR3): «Hay un error» stores a reported_issue with the note; the owner sees it", async () => {
    const id = anaPay.receipts[1]!.id;
    const detail = (await me(anaToken, `/v1/customer/me/receipts/${id}`)).body;
    expect((await ack(anaToken, id, { kind: "reported_issue", receiptHash: detail.contentHash })).status).toBe(400);
    expect((await ack(anaToken, id, { kind: "reported_issue", receiptHash: detail.contentHash, note: "  no  " })).status).toBe(400);
    const r = await ack(anaToken, id, { kind: "reported_issue", receiptHash: detail.contentHash, note: "  El abono fue de 2.000, no de 1.000  " });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: "reported_issue", note: "El abono fue de 2.000, no de 1.000", claimId: null });
    expect((await me(anaToken, `/v1/customer/me/receipts/${id}`)).body.ackState).toBe("reported");
    const owner = await api().get(`/v1/receipts/${id}`).set(admin(a));
    expect(owner.body.ackState).toBe("reported");
    expect(owner.body.acks).toEqual([expect.objectContaining({ kind: "reported_issue", note: "El abono fue de 2.000, no de 1.000", channel: "portal" })]);
    const list = await api().get(`/v1/receipts?customerId=${ana.id}`).set(admin(a));
    expect((list.body as Array<{ id: string; ackState: string }>).find((x) => x.id === id)!.ackState).toBe("reported");
  });

  it("T15: a confirmation with a hash different from the current one → 409 (the customer saw another version)", async () => {
    const id = anaPay.receipts[0]!.id;
    const r = await ack(anaToken, id, { kind: "acknowledged", receiptHash: sha("otra versión") });
    expect(r.status).toBe(409);
    expect(r.body.code ?? r.body.error?.code).toBe("RECEIPT_HASH_MISMATCH");
    expect(await prisma.receiptAcknowledgement.count({ where: { receiptId: id } })).toBe(0);
    expect((await ack(anaToken, id, { kind: "acknowledged", receiptHash: "not-a-hash" })).status).toBe(400);
    expect((await ack(anaToken, id, { kind: "otro", receiptHash: "a".repeat(64) })).status).toBe(400);
    expect((await ack(anaToken, id, { kind: "acknowledged", receiptHash: "a".repeat(64), extra: 1 })).status).toBe(400);
  });

  it("T25: no confirmation without the portal login (code + PIN): no token, owner token or forged token → 401", async () => {
    const id = anaSale.receipts[0]!.id;
    const body = { kind: "acknowledged", receiptHash: "a".repeat(64) };
    expect((await api().post(`/v1/customer/me/receipts/${id}/ack`).send(body)).status).toBe(401);
    expect((await api().post(`/v1/customer/me/receipts/${id}/ack`).set(admin(a)).send(body)).status).toBe(401);
    expect((await api().post(`/v1/customer/me/receipts/${id}/ack`).set("Authorization", "Bearer x.y.z").send(body)).status).toBe(401);
    expect((await api().get("/v1/customer/me/receipts")).status).toBe(401);
    expect((await api().get(`/v1/customer/me/receipts/${id}`).set(admin(a))).status).toBe(401);
    // Beto (logged in) cannot confirm Ana's receipt.
    expect((await ack(betoToken, id, body)).status).toBe(404);
  });

  it("§7 ledger: owner and portal movements carry receiptId, number and ackState; the return shows its DC-D- number", async () => {
    const ret = await post(a, `/v1/sales/${anaSale.id}/returns`, { lines: [{ saleLineId: anaSale.lines[0]!.id, qty: 1 }] });
    expect(ret.status).toBe(201);
    const owner = (await api().get(`/v1/customers/${ana.id}/ledger`).set(admin(a))).body;
    const sale = owner.sales.find((s: { id: string }) => s.id === anaSale.id);
    expect(sale).toMatchObject({ number: "DC-000001", receiptId: anaSale.receipts[0]!.id, ackState: "acknowledged" });
    expect(sale.returns[0]).toMatchObject({ number: "DC-D-000001", receiptId: ret.body.receipts[0].id, ackState: "pending" });
    expect(owner.payments[0]).toMatchObject({ number: "DC-P-000001", receiptId: anaPay.receipts[0]!.id, ackState: "pending" });
    const portal = (await me(anaToken, "/v1/customer/me/ledger")).body;
    expect(portal.sales[0]).toMatchObject({ number: "DC-000001", receiptId: anaSale.receipts[0]!.id, ackState: "acknowledged" });
    expect(portal.sales[0].returns[0]).toMatchObject({ number: "DC-D-000001", receiptId: ret.body.receipts[0].id, ackState: "pending" });
    expect(portal.payments[0]).toMatchObject({ number: "DC-P-000001", receiptId: anaPay.receipts[0]!.id, ackState: "pending" });
  });
});
