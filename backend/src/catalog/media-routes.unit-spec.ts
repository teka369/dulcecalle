import type { INestApplication } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../app.module";
import { PrismaService } from "../prisma/prisma.service";
import { HttpErrorFilter } from "../shared/http/http-error.filter";

/**
 * Production incident regression test (2026-09-22):
 * `POST /v1/products/:id/image-signature` returned
 * `{"error":{"code":"NOT_FOUND","message":"No encontramos eso."}}` and the
 * UI showed "0 de 1 fotos cargadas".
 *
 * Root cause was NOT MediaService.requireProduct: the deployed build did not
 * register the media routes at all. Nest's router 404 is rewritten by
 * HttpErrorFilter into the same app envelope as a genuine missing product,
 * so the two cases are indistinguishable from the client. Anonymous probes
 * proved it: a missing route and a missing product both answer 404 +
 * NOT_FOUND, while an existing guarded route answers 401 anonymous.
 *
 * These tests boot the REAL AppModule (production module graph) with only
 * PrismaService mocked, and assert the media routes exist (401 anonymous,
 * never router-404) plus the genuine requireProduct paths.
 */
describe("media routes wiring (AppModule)", () => {
  const BIZ = "11111111-1111-4111-8111-111111111111";
  const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PROD = "22222222-2222-4222-8222-222222222222";
  const REQ = "33333333-3333-4333-8333-333333333333";

  const prismaMock = {
    businessMembership: {
      findUnique: async () => ({
        role: "owner",
        business: { timezone: "America/Bogota" },
      }),
    },
    product: { findFirst: async () => null },
    productImage: {
      findFirst: async () => null,
      findMany: async () => [],
      findUnique: async () => null,
    },
    $transaction: async () => ({}),
  };

  let app: INestApplication;
  let jwt: JwtService;

  function token(): string {
    return jwt.sign({ sub: USER, email: "dueña@dulcecalle.test" });
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();
    jwt = moduleRef.get(JwtService, { strict: false });
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it("POST signature exists: anonymous gets 401, not router-404", async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/products/${PROD}/image-signature`)
      .send({ requestId: REQ });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
    });
  });

  it("POST register exists: anonymous gets 401, not router-404", async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/products/${PROD}/images`)
      .send({ requestId: REQ, publicId: "x", secureUrl: "https://x" });
    expect(res.status).toBe(401);
  });

  it("GET images exists: anonymous gets 401, not router-404", async () => {
    const res = await request(app.getHttpServer()).get(
      `/v1/products/${PROD}/images`,
    );
    expect(res.status).toBe(401);
  });

  it("authenticated signature for an unknown product is a genuine app 404", async () => {
    const res = await request(app.getHttpServer())
      .post(`/v1/products/${PROD}/image-signature`)
      .set("Authorization", `Bearer ${token()}`)
      .set("X-Business-Id", BIZ)
      .set("Idempotency-Key", REQ)
      .send({ requestId: REQ });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: { code: "NOT_FOUND", message: "No encontramos eso." },
    });
  });

  it("authenticated signature for an existing product returns a grant without secrets", async () => {
    const OLD = { ...process.env };
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "key123";
    process.env.CLOUDINARY_API_SECRET = "shhh-test-only";
    prismaMock.product.findFirst = async () => ({ id: PROD }) as never;
    try {
      const res = await request(app.getHttpServer())
        .post(`/v1/products/${PROD}/image-signature`)
        .set("Authorization", `Bearer ${token()}`)
        .set("X-Business-Id", BIZ)
        .set("Idempotency-Key", REQ)
        .send({ requestId: REQ });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        cloudName: "demo",
        apiKey: "key123",
        requestId: REQ,
      });
      expect(typeof res.body.signature).toBe("string");
      expect(typeof res.body.uploadUrl).toBe("string");
      expect(res.body.publicId).toContain(PROD);
      expect(JSON.stringify(res.body)).not.toContain("shhh-test-only");
    } finally {
      process.env = { ...OLD };
      prismaMock.product.findFirst = async () => null;
    }
  });
});
