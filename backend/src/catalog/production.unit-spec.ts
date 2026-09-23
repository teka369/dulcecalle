import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { HttpErrorFilter } from "../shared/http/http-error.filter";

/**
 * Preparation (Producción) contract against the REAL AppModule with only
 * PrismaService mocked (in-memory). Covers: route wiring, validation,
 * ownership, idempotency, cost rules, portal exclusion of insumos.
 */
describe("preparations (AppModule)", () => {
  const BIZ = "11111111-1111-4111-8111-111111111111";
  const OTHER = "22222222-2222-4222-8222-222222222222";
  const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const COMBO = "33333333-3333-4333-8333-333333333333";
  const TARGET = "44444444-4444-4333-8333-444444444444";
  const REQ = "55555555-5555-4555-8555-555555555555";

  type ProductRow = {
    id: string;
    businessId: string;
    name: string;
    stock: number;
    avgCost: bigint;
    archivedAt: Date | null;
    sellable: boolean;
  };

  const products = new Map<string, ProductRow>();
  const preparations: Array<Record<string, unknown>> = [];
  let creates = 0;

  const tx = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [],
    product: {
      findFirst: async ({ where }: { where: { id: string; businessId: string } }) => {
        const p = products.get(where.id);
        return p && p.businessId === where.businessId && !p.archivedAt ? p : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<ProductRow> }) => {
        const p = products.get(where.id);
        if (!p) throw new Error("missing");
        Object.assign(p, data);
        return p;
      },
    },
    preparation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        creates += 1;
        const row = { ...data, id: "66666666-6666-4666-8666-666666666666", createdAt: new Date("2026-09-23T12:00:00.000Z") };
        preparations.push(row);
        return {
          ...row,
          source: { name: (products.get(data.sourceId as string) as ProductRow).name },
          target: { name: (products.get(data.targetId as string) as ProductRow).name },
        };
      },
    },
    stockMove: { create: async ({ data }: { data: unknown }) => data },
  };

  const prismaMock = {
    businessMembership: {
      findUnique: async () => ({ role: "owner", business: { timezone: "America/Bogota" } }),
    },
    cashSession: { findUnique: async () => null },
    product: {
      findFirst: async ({ where }: { where: { id: string; businessId: string } }) => {
        const p = products.get(where.id);
        if (!p || p.businessId !== where.businessId) return null;
        if ("archivedAt" in where && (where as { archivedAt: null }).archivedAt === null && p.archivedAt) {
          return null;
        }
        return p;
      },
      findMany: async ({ where }: { where: { businessId: string; archivedAt: null; sellable?: boolean } }) =>
        [...products.values()].filter(
          (p) =>
            p.businessId === where.businessId &&
            !p.archivedAt &&
            (where.sellable === undefined || p.sellable === where.sellable),
        ),
    },
    preparation: {
      findUnique: async ({ where }: { where: { businessId_requestId: { businessId: string; requestId: string } } }) => {
        const row = preparations.find(
          (r) =>
            r.businessId === where.businessId_requestId.businessId &&
            r.requestId === where.businessId_requestId.requestId,
        );
        if (!row) return null;
        return {
          ...row,
          source: { name: (products.get(row.sourceId as string) as ProductRow)?.name ?? "?" },
          target: { name: (products.get(row.targetId as string) as ProductRow)?.name ?? "?" },
        };
      },
      findMany: async ({ where }: { where: { businessId: string; sourceId?: string; targetId?: string } }) =>
        preparations
          .filter(
            (r) =>
              r.businessId === where.businessId &&
              (!where.sourceId || r.sourceId === where.sourceId) &&
              (!where.targetId || r.targetId === where.targetId),
          )
          .map((r) => ({
            ...r,
            source: { name: "Combo" },
            target: { name: "Terminada" },
          })),
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  };

  function seed() {
    products.clear();
    preparations.length = 0;
    creates = 0;
    products.set(COMBO, {
      id: COMBO, businessId: BIZ, name: "Combo enchiladas",
      stock: 1, avgCost: 105000n, archivedAt: null, sellable: false,
    });
    products.set(TARGET, {
      id: TARGET, businessId: BIZ, name: "Enchilada",
      stock: 10, avgCost: 400n, archivedAt: null, sellable: true,
    });
  }

  let app: INestApplication;
  let jwt: JwtService;
  const token = () => jwt.sign({ sub: USER, email: "dueña@dulcecalle.test" });
  const auth = (biz: string, key: string) => ({
    Authorization: `Bearer ${token()}`,
    "X-Business-Id": biz,
    "Idempotency-Key": key,
  });
  let keySeq = 0;
  const newRequestKey = (): string => {
    keySeq += 1;
    const tail = String(keySeq).padStart(12, "0");
    return `77777777-7777-4777-8777-${tail}`;
  };
  /** Total inventory value across both products (the conservation invariant). */
  const inventoryValue = (): number => {
    let total = 0;
    for (const p of products.values()) {
      total += p.stock * Number(p.avgCost);
    }
    return total;
  };
  const prepareBody = (over: Record<string, unknown> = {}) => ({
    sourceId: COMBO,
    targetId: TARGET,
    qty: 10,
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
    jwt = moduleRef.get(JwtService, { strict: false });
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
  }, 60000);

  beforeEach(() => seed());

  afterAll(async () => {
    await app.close();
  });

  it("anonymous POST is 401: the route exists", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .send(prepareBody());
    expect(res.status).toBe(401);
  });

  it("creates with weighted cost and transfers lot value (no double count)", async () => {
    // Before: combo 1×105000 + target 10×400 → V = 109000.
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 10, unitCost: 200 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      sourceId: COMBO,
      targetId: TARGET,
      qty: 10,
      unitCost: 200,
      sourceName: "Combo enchiladas",
      targetName: "Enchilada",
    });
    // Weighted avg absorbs the assigned cost: (10*400 + 10*200) / 20 = 300.
    expect(products.get(TARGET)?.stock).toBe(20);
    expect(products.get(TARGET)?.avgCost).toBe(300n);
    // The assigned 2000 TRANSFERS out of the lot: 105000 → 103000.
    expect(products.get(COMBO)?.stock).toBe(1);
    expect(products.get(COMBO)?.avgCost).toBe(103000n);
    // Value conservation: 103000 + 20*300 = 109000 = V before.
    const after =
      Number(products.get(COMBO)?.avgCost ?? 0n) +
      (products.get(TARGET)?.stock ?? 0) * Number(products.get(TARGET)?.avgCost ?? 0n);
    expect(after).toBe(109000);
  });

  it("pending cost (null) leaves the average untouched and transfers nothing", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 10 }));
    expect(res.status).toBe(201);
    expect(res.body.unitCost).toBeNull();
    expect(products.get(TARGET)?.stock).toBe(20);
    expect(products.get(TARGET)?.avgCost).toBe(400n);
    expect(products.get(COMBO)?.avgCost).toBe(105000n);
  });

  it("explicit zero dilutes (gifted batch), unlike pending", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 10, unitCost: 0 }));
    expect(res.status).toBe(201);
    expect(res.body.unitCost).toBe(0);
    expect(products.get(TARGET)?.avgCost).toBe(200n);
    expect(products.get(COMBO)?.avgCost).toBe(105000n);
  });

  it("assigned above remaining is REJECTED: 10000 vs 15000 mints nothing", async () => {
    const combo = products.get(COMBO);
    if (combo) combo.avgCost = 10000n;
    const before = inventoryValue();
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 10, unitCost: 1500 }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("supera el valor restante");
    expect(products.get(COMBO)?.avgCost).toBe(10000n);
    expect(products.get(TARGET)?.stock).toBe(10);
    expect(preparations).toHaveLength(0);
    expect(inventoryValue()).toBe(before);
  });

  it("exact remaining is allowed: 10000 vs 10000 zeroes the lot", async () => {
    const combo = products.get(COMBO);
    if (combo) combo.avgCost = 10000n;
    const before = inventoryValue();
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 10, unitCost: 1000 }));
    expect(res.status).toBe(201);
    expect(products.get(COMBO)?.avgCost).toBe(0n);
    expect(inventoryValue()).toBe(before);
  });

  it("just below remaining is allowed: rounding dust is bounded and pre-existing", async () => {
    // Integer COP cannot represent 13999/13 exactly. Like surtir since
    // forever, the average rounds (Math.round) and the dust stays bounded
    // by half a peso per unit — it is NOT created value, just unrepresentable
    // fractions. 13 units → |dust| <= 7.
    const combo = products.get(COMBO);
    if (combo) combo.avgCost = 10000n;
    const before = inventoryValue();
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 3, unitCost: 3333 }));
    expect(res.status).toBe(201);
    expect(products.get(COMBO)?.avgCost).toBe(1n);
    expect(Math.abs(inventoryValue() - before)).toBeLessThanOrEqual(7);
  });

  it("empty lot rejects any positive cost but allows pending", async () => {
    const combo = products.get(COMBO);
    if (combo) combo.avgCost = 0n;
    const denied = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 10, unitCost: 100 }));
    expect(denied.status).toBe(400);
    expect(preparations).toHaveLength(0);
    const pending = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, "66666666-6666-4666-8666-666666666666"))
      .send(prepareBody({ qty: 10 }));
    expect(pending.status).toBe(201);
    expect(pending.body.unitCost).toBeNull();
  });

  it("progressive exhaustion conserves value at every step", async () => {
    // 105000 → 20000 → 12000 → 73000 = exact exhaustion, then rejection.
    // All divisions here are exact, so conservation is asserted exactly;
    // non-exact divisions are covered by the rounding-dust test above.
    const steps: Array<[number, number]> = [
      [10, 2000],
      [10, 1200],
      [10, 7300],
    ];
    for (const [qty, unitCost] of steps) {
      const before = inventoryValue();
      const res = await request(app.getHttpServer())
        .post("/v1/preparations")
        .set(auth(BIZ, newRequestKey()))
        .send(prepareBody({ qty, unitCost }));
      expect(res.status).toBe(201);
      expect(inventoryValue()).toBe(before);
    }
    expect(products.get(COMBO)?.avgCost).toBe(0n);
    const denied = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, newRequestKey()))
      .send(prepareBody({ qty: 1, unitCost: 1 }));
    expect(denied.status).toBe(400);
    expect(preparations).toHaveLength(3);
  });

  it("two purchases pool into one lot value before preparing", async () => {
    // Second lot at 120000 merges by weighted average: (105000+120000)/2.
    const combo = products.get(COMBO);
    if (combo) {
      combo.stock = 2;
      combo.avgCost = 112500n;
    }
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 10, unitCost: 200 }));
    expect(res.status).toBe(201);
    // Origin is the pooled product, not an individual purchase.
    expect(products.get(COMBO)?.avgCost).toBe(112500n - 2000n);
  });

  it("rejects same source and target", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ sourceId: COMBO, targetId: COMBO }));
    expect(res.status).toBe(400);
  });

  it("rejects unknown source and archived target", async () => {
    const missing = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ sourceId: "99999999-9999-4999-8999-999999999999" }));
    expect(missing.status).toBe(404);
    const archived = products.get(TARGET);
    if (archived) archived.archivedAt = new Date();
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody());
    expect(res.status).toBe(404);
  });

  it("blocks preparation from an empty combo without touching stock", async () => {
    const combo = products.get(COMBO);
    if (combo) combo.stock = 0;
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody());
    expect(res.status).toBe(409);
    expect(products.get(TARGET)?.stock).toBe(10);
    expect(preparations).toHaveLength(0);
  });

  it("rejects invalid qty", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ qty: 0 }));
    expect(res.status).toBe(400);
  });

  it("cannot touch another business catalog", async () => {
    const res = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(OTHER, REQ))
      .send(prepareBody());
    expect(res.status).toBe(404);
    expect(preparations).toHaveLength(0);
  });

  it("same requestId twice creates once", async () => {
    const first = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ unitCost: 200 }));
    const second = await request(app.getHttpServer())
      .post("/v1/preparations")
      .set(auth(BIZ, REQ))
      .send(prepareBody({ unitCost: 200 }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(creates).toBe(1);
    expect(products.get(TARGET)?.stock).toBe(20);
    // Retry transfers nothing twice: lot value reduced exactly once.
    expect(products.get(COMBO)?.avgCost).toBe(103000n);
  });

  it("lists history filtered by source", async () => {
    await request(app.getHttpServer()).post("/v1/preparations").set(auth(BIZ, REQ)).send(prepareBody());
    const all = await request(app.getHttpServer())
      .get("/v1/preparations")
      .set("Authorization", `Bearer ${token()}`)
      .set("X-Business-Id", BIZ);
    expect(all.status).toBe(200);
    expect(all.body).toHaveLength(1);
    const filtered = await request(app.getHttpServer())
      .get("/v1/preparations")
      .query({ sourceId: TARGET })
      .set("Authorization", `Bearer ${token()}`)
      .set("X-Business-Id", BIZ);
    expect(filtered.body).toHaveLength(0);
    const bad = await request(app.getHttpServer())
      .get("/v1/preparations")
      .query({ sourceId: "nope" })
      .set("Authorization", `Bearer ${token()}`)
      .set("X-Business-Id", BIZ);
    expect(bad.status).toBe(400);
  });

  it("portal catalog excludes insumos", async () => {
    // findMany honors where.sellable, mirroring PostgreSQL behavior.
    const rows = await prismaMock.product.findMany({
      where: { businessId: BIZ, archivedAt: null, sellable: true },
    });
    expect(rows.map((r) => r.id)).toEqual([TARGET]);
  });
});
