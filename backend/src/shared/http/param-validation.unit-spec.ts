import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CashController } from "../../cash/cash.controller";
import { CashService } from "../../cash/cash.service";
import { CashManagerService } from "../../cash/cash-manager.service";
import { CatalogController } from "../../catalog/catalog.controller";
import { CatalogService } from "../../catalog/catalog.service";
import { MediaController } from "../../catalog/media.controller";
import { MediaService } from "../../catalog/media.service";
import { SalesController } from "../../sales/sales.controller";
import { SalesService } from "../../sales/sales.service";
import { HttpErrorFilter } from "./http-error.filter";

/** loop/v1 M3/M4: a non-UUID :id or an invalid date answers 400 VALIDATION and never reaches the service (no 500). */
const calls: string[] = [];
function anyService() {
  return new Proxy({} as Record<string, unknown>, {
    get: (t, k: string | symbol) => typeof k === "symbol" || k === "then" || k === "onModuleInit" || k === "onModuleDestroy" ? undefined : (t[k] ??= async () => {
      calls.push(k);
      return {};
    }),
  });
}

const BAD = "not-a-uuid";
const OK = "11111111-1111-4111-8111-111111111111";
const ID_ROUTES: Array<[string, string]> = [
  ["post", "/cash/sessions/:id/close"],
  ["get", "/cash/sessions/:id"],
  ["post", "/cash/moves/:id/assign"],
  ["post", "/cash/sessions/:id/carry"],
  ["post", "/customers/:id/payments"],
  ["get", "/products/:id"],
  ["get", "/products/:id/moves"],
  ["patch", "/products/:id"],
  ["post", "/products/:id/archive"],
  ["post", "/products/:id/surtir"],
  ["post", "/products/:id/shrink"],
  ["get", "/customers/:id"],
  ["get", "/customers/:id/ledger"],
  ["patch", "/customers/:id"],
  ["post", "/customers/:id/pin"],
  ["post", "/customers/:id/initial-debts"],
  ["get", "/suppliers/:id"],
  ["get", "/suppliers/:id/surtidas"],
  ["patch", "/suppliers/:id"],
  ["post", "/products/:id/image-signature"],
  ["post", "/products/:id/images"],
  ["get", "/products/:id/images"],
  ["patch", "/products/:id/images/reorder"],
  ["patch", "/products/:id/images/:imageId"],
  ["delete", "/products/:id/images/:imageId"],
  ["get", "/sales/:id/returns"],
  ["post", "/sales/:id/returns"],
  ["get", "/sales/:id"],
];
const DATE_QUERIES = [
  "/cash/moves?date=hoy",
  "/cash/moves?from=2026-13-01",
  "/cash/moves?to=2026-02-30",
  "/expenses?from=ayer",
  "/expenses?to=2026-1-5",
  "/sales?from=hoy",
  "/sales?to=2026-10-19T00:00:00Z",
  "/preparations?sourceId=x",
  "/preparations?targetId=x",
];

describe("param validation (M3/M4)", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [CashController, CatalogController, MediaController, SalesController],
      providers: [CashService, CashManagerService, CatalogService, MediaService, SalesService].map((p) => ({ provide: p, useValue: anyService() })),
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => (calls.length = 0));

  it.each(ID_ROUTES)("%s %s with a non-UUID id → 400 VALIDATION, service not called", async (method, path) => {
    for (const p of [path.replace(":id", BAD).replace(":imageId", OK), path.replace(":id", OK).replace(":imageId", BAD)]) {
      if (!path.includes(":imageId") && p.includes(OK)) continue;
      const res = await (request(app.getHttpServer()) as unknown as Record<string, (u: string) => request.Test>)[method](p).send({});
      expect({ p, status: res.status, code: res.body?.error?.code }).toEqual({ p, status: 400, code: "VALIDATION" });
    }
    expect(calls).toEqual([]);
  });

  it.each(DATE_QUERIES)("GET %s → 400 VALIDATION, service not called", async (url) => {
    const res = await request(app.getHttpServer()).get(url);
    expect({ status: res.status, code: res.body?.error?.code }).toEqual({ status: 400, code: "VALIDATION" });
    expect(calls).toEqual([]);
  });

  it("valid ids and dates still reach the service", async () => {
    await request(app.getHttpServer()).get(`/products/${OK}`).expect(200);
    await request(app.getHttpServer()).get("/sales?from=2026-10-01&to=2026-10-19").expect(200);
    await request(app.getHttpServer()).get("/cash/moves?date=2024-02-29").expect(200);
    await request(app.getHttpServer()).get(`/preparations?sourceId=${OK}`).expect(200);
    expect(calls.length).toBe(4);
  });
});

describe("HttpErrorFilter maps Prisma client errors (M3/M4 fallback)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Prisma } = require("@prisma/client") as typeof import("@prisma/client");
  function run(e: unknown) {
    let out: { status?: number; body?: unknown } = {};
    const res = { status: (s: number) => ({ json: (b: unknown) => (out = { status: s, body: b }) }) };
    const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ headers: {} }) }) };
    new HttpErrorFilter().catch(e, host as never);
    return out;
  }
  it("P2023 (malformed uuid) → 400 VALIDATION", () => {
    const e = new Prisma.PrismaClientKnownRequestError("Inconsistent column data", { code: "P2023", clientVersion: "x" });
    expect(run(e)).toEqual({ status: 400, body: { error: { code: "VALIDATION", message: "Datos inválidos." } } });
  });
  it("P2025 (record not found) → 404 NOT_FOUND", () => {
    const e = new Prisma.PrismaClientKnownRequestError("not found", { code: "P2025", clientVersion: "x" });
    expect(run(e)).toMatchObject({ status: 404 });
  });
  it("PrismaClientValidationError (Invalid Date) → 400 VALIDATION", () => {
    const e = new Prisma.PrismaClientValidationError("Invalid value for argument `gte`: Provided Date object is invalid.", { clientVersion: "x" });
    expect(run(e)).toMatchObject({ status: 400 });
  });
  it("unknown errors stay 500", () => {
    expect(run(new Error("boom"))).toMatchObject({ status: 500 });
  });
});
