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
import { comboCandidates } from "../migration/combo-kind";
import { startLocalPostgres, type PgHandle } from "./pg-harness";
import { seedOwner } from "./seed-owner";

installBigIntJson();

/** TICKET-A: Product.kind (standard | combo) against real Postgres. */
describe("TICKET-A product kind", () => {
  let app: INestApplication;
  let pg: PgHandle | null = null;
  let prisma: PrismaService;
  let token = "";
  let biz = "";

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
    const owner = await seedOwner(app, "kind@test.co", "Kind");
    token = owner.accessToken;
    biz = owner.business.id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    pg?.stop();
  });

  const api = () => request(app.getHttpServer());
  const auth = (key: string = randomUUID()) => ({
    Authorization: `Bearer ${token}`,
    "X-Business-Id": biz,
    "Idempotency-Key": key,
  });
  const create = (body: Record<string, unknown>) => api().post("/v1/products").set(auth()).send(body);

  it("AC1: combo forces sellable=false even if the client asks for true", async () => {
    const r = await create({ name: "Combo forzado", price: 0, kind: "combo", sellable: true });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ kind: "combo", sellable: false });
  });

  it("AC1: default kind is standard; invalid kind is 400", async () => {
    const r = await create({ name: "Normal", price: 1000 });
    expect(r.body).toMatchObject({ kind: "standard", sellable: true });
    const bad = await create({ name: "Raro", price: 0, kind: "kit" });
    expect(bad.status).toBe(400);
  });

  it("AC1: DB CHECK rejects a sellable combo written behind the API", async () => {
    const id = randomUUID();
    await expect(
      prisma.product.create({
        data: { id, businessId: biz, name: "Trampa", category: "General", price: 0n, avgCost: 0n, stock: 0, lowStockAt: 5, kind: "combo", sellable: true },
      }),
    ).rejects.toThrow();
  });

  it("AC1: selling a combo is 400 and moves nothing", async () => {
    const c = await create({ name: "Combo venta", price: 0, kind: "combo", stock: 1, avgCost: 50000 });
    const r = await api()
      .post("/v1/sales")
      .set(auth())
      .send({ lines: [{ productId: c.body.id, qty: 1 }], paymentKind: "paid", amountReceived: 50000, method: "Efectivo" });
    expect(r.status).toBe(400);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: c.body.id } });
    expect(row.stock).toBe(1);
  });

  it("AC1: PATCH sellable=true on a combo is 400", async () => {
    const c = await create({ name: "Combo patch", price: 0, kind: "combo" });
    const r = await api().patch(`/v1/products/${c.body.id}`).set(auth()).send({ sellable: true });
    expect(r.status).toBe(400);
  });

  it("AC3: changing kind with stock is 409 KIND_LOCKED; without history it is allowed", async () => {
    const withStock = await create({ name: "Con stock", price: 0, kind: "combo", stock: 1, avgCost: 1000 });
    const r = await api().patch(`/v1/products/${withStock.body.id}`).set(auth()).send({ kind: "standard" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("KIND_LOCKED");
    const fresh = await create({ name: "Vacío", price: 0, sellable: false });
    const ok = await api().patch(`/v1/products/${fresh.body.id}`).set(auth()).send({ kind: "combo" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ kind: "combo", sellable: false });
  });

  it("AC3: kind locked by history even after stock returns to 0", async () => {
    const c = await create({ name: "Historia", price: 0, kind: "combo", stock: 1, avgCost: 1000 });
    await prisma.product.update({ where: { id: c.body.id }, data: { stock: 0 } });
    const r = await api().patch(`/v1/products/${c.body.id}`).set(auth()).send({ kind: "standard" });
    expect(r.status).toBe(409);
  });

  it("AC2+AC4: surtir pools lot value, preparation transfers it with weighted avg, retry applies once, excess rejected", async () => {
    const combo = await create({ name: "Combo enchiladas", price: 0, kind: "combo", stock: 1, avgCost: 100000 });
    const target = await create({ name: "Enchilada", price: 3000, stock: 10, avgCost: 400 });
    const s = await api()
      .post(`/v1/products/${combo.body.id}/surtir`)
      .set(auth())
      .send({ qty: 1, unitCost: 20000, totalCost: 20000, method: "Efectivo" });
    expect(s.status).toBeLessThan(300);
    let c = await prisma.product.findUniqueOrThrow({ where: { id: combo.body.id } });
    expect(c.stock).toBe(2);
    expect(c.avgCost).toBe(120000n); // lot value: 100000 + 20000

    const key = randomUUID();
    const body = { sourceId: combo.body.id, targetId: target.body.id, qty: 10, unitCost: 200 };
    const first = await api().post("/v1/preparations").set(auth(key)).send(body);
    const replay = await api().post("/v1/preparations").set(auth(key)).send(body); // offline outbox retry
    expect(first.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    const t = await prisma.product.findUniqueOrThrow({ where: { id: target.body.id } });
    expect(t.stock).toBe(20);
    expect(t.avgCost).toBe(300n); // (10*400 + 10*200)/20
    c = await prisma.product.findUniqueOrThrow({ where: { id: combo.body.id } });
    expect(c.avgCost).toBe(118000n);
    expect(await prisma.preparation.count({ where: { sourceId: combo.body.id } })).toBe(1);

    const excess = await api()
      .post("/v1/preparations")
      .set(auth())
      .send({ ...body, qty: 1, unitCost: 118001 });
    expect(excess.status).toBe(400);
  });

  it("J-A3: preparation from a standard (even sellable:false) is 400", async () => {
    const insumo = await create({ name: "Insumo viejo", price: 0, sellable: false, stock: 1, avgCost: 5000 });
    const target = await create({ name: "Destino", price: 100 });
    const r = await api()
      .post("/v1/preparations")
      .set(auth())
      .send({ sourceId: insumo.body.id, targetId: target.body.id, qty: 1 });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toContain("combo");
  });

  it("AC6: legacy sellable:false standard keeps lot-value cost and stays out of sales", async () => {
    const insumo = await create({ name: "Insumo lote", price: 0, sellable: false, stock: 2, avgCost: 5000 });
    expect(insumo.body.kind).toBe("standard");
    const row = await prisma.product.findUniqueOrThrow({ where: { id: insumo.body.id } });
    expect(row.avgCost).toBe(10000n); // lot value, as before TICKET-A
    const sale = await api()
      .post("/v1/sales")
      .set(auth())
      .send({ lines: [{ productId: insumo.body.id, qty: 1 }], paymentKind: "paid", amountReceived: 1, method: "Efectivo" });
    expect(sale.status).toBe(400);
  });

  it("J-A2: candidate finder lists only non-sellable standards, ranks prep history first", () => {
    const base = { businessId: biz, stock: 0, avgCost: 0n, archivedAt: null, surtidos: 0, preparationsAsSource: 0 };
    const list = comboCandidates([
      { ...base, id: "a", name: "Vendible", sellable: true, kind: "standard" },
      { ...base, id: "b", name: "Sin historia", sellable: false, kind: "standard" },
      { ...base, id: "c", name: "Con prep", sellable: false, kind: "standard", preparationsAsSource: 2 },
      { ...base, id: "d", name: "Ya combo", sellable: false, kind: "combo" },
    ]);
    expect(list.map((x) => [x.id, x.confidence])).toEqual([["c", "alta"], ["b", "baja"]]);
  });
});
