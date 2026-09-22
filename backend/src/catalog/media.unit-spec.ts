import { createHash } from "node:crypto";
import {
  MediaService,
  deliveryUrl,
  imagePublicId,
  parseImagePublicId,
  readCloudinaryConfig,
  signUploadParams,
} from "./media.service";

describe("media pure helpers", () => {
  it("signs exactly timestamp+public_id per Cloudinary docs", () => {
    const secret = "abcd";
    const params = { public_id: "sample_image", timestamp: 1315060510 };
    const expected = createHash("sha1")
      .update("public_id=sample_image&timestamp=1315060510" + secret)
      .digest("hex");
    expect(signUploadParams(params, secret)).toBe(expected);
  });

  it("signs timestamp-only payloads", () => {
    const secret = "abcd";
    const expected = createHash("sha1")
      .update("timestamp=1315060510" + secret)
      .digest("hex");
    expect(signUploadParams({ timestamp: 1315060510 }, secret)).toBe(expected);
  });

  it("sorts signed params alphabetically", () => {
    const a = signUploadParams(
      { timestamp: 1, public_id: "x", eager: "w_1" },
      "s",
    );
    const b = signUploadParams(
      { eager: "w_1", public_id: "x", timestamp: 1 },
      "s",
    );
    expect(a).toBe(b);
  });

  it("builds deterministic tenant-scoped public ids", () => {
    const biz = "11111111-1111-4111-8111-111111111111";
    const prod = "22222222-2222-4222-8222-222222222222";
    const req = "33333333-3333-4333-8333-333333333333";
    const publicId = imagePublicId(biz, prod, req);
    expect(publicId).toBe(`dulcecalle/${biz}/products/${prod}/${req}`);
    expect(parseImagePublicId(publicId)).toEqual({
      businessId: biz,
      productId: prod,
      requestId: req,
    });
  });

  it("rejects foreign or malformed public ids", () => {
    expect(parseImagePublicId("other/biz/products/x/y")).toBeNull();
    expect(parseImagePublicId("dulcecalle/not-a-uuid/products/x/y")).toBeNull();
    expect(parseImagePublicId("dulcecalle/a/b")).toBeNull();
    expect(parseImagePublicId("")).toBeNull();
  });

  it("builds delivery URLs with a single transformation", () => {
    expect(deliveryUrl("demo", "dulcecalle/x", "jpg", "w_160,h_160,c_fill")).toBe(
      "https://res.cloudinary.com/demo/image/upload/w_160,h_160,c_fill/dulcecalle/x.jpg",
    );
    expect(deliveryUrl("demo", "dulcecalle/x", null)).toBe(
      "https://res.cloudinary.com/demo/image/upload/dulcecalle/x",
    );
    expect(deliveryUrl("demo", "dulcecalle/x", "jpg")).toBe(
      "https://res.cloudinary.com/demo/image/upload/dulcecalle/x.jpg",
    );
  });

  it("requires all three server env vars, exposes nothing", () => {
    expect(
      readCloudinaryConfig({} as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      readCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: "c",
        CLOUDINARY_API_KEY: "k",
      } as NodeJS.ProcessEnv),
    ).toBeNull();
    expect(
      readCloudinaryConfig({
        CLOUDINARY_CLOUD_NAME: "c",
        CLOUDINARY_API_KEY: "k",
        CLOUDINARY_API_SECRET: "s",
      } as NodeJS.ProcessEnv),
    ).toEqual({ cloudName: "c", apiKey: "k", apiSecret: "s" });
  });
});

const BIZ = "11111111-1111-4111-8111-111111111111";
const PROD = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const IMG = "44444444-4444-4333-8333-444444444444";

function ctx() {
  return { businessId: BIZ, userId: "u", role: "owner", timezone: "America/Bogota" } as never;
}

function env() {
  process.env.CLOUDINARY_CLOUD_NAME = "demo";
  process.env.CLOUDINARY_API_KEY = "key";
  process.env.CLOUDINARY_API_SECRET = "secret";
}

function destroyFetch(result: unknown, status = 200) {
  return (async () =>
    new Response(JSON.stringify(result), { status })) as typeof fetch;
}

describe("media removeImage lifecycle", () => {
  const OLD_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  function serviceWith(
    product: unknown,
    image: unknown,
    fetchImpl: typeof fetch,
    txStubs: { deleted: string[]; promoted: string[] } = { deleted: [], promoted: [] },
  ) {
    const prisma = {
      product: { findFirst: async () => product },
      productImage: {
        findFirst: async () => image,
        delete: async () => ({}),
        update: async () => ({}),
      },
      $transaction: async (fn: (tx: never) => Promise<unknown>) => {
        const tx = {
          productImage: {
            delete: async (args: { where: { id: string } }) => {
              txStubs.deleted.push(args.where.id);
              return {};
            },
            findFirst: async () => null,
            update: async (args: { where: { id: string } }) => {
              txStubs.promoted.push(args.where.id);
              return {};
            },
          },
        };
        return fn(tx as never);
      },
    };
    return { service: new MediaService(prisma as never, fetchImpl), txStubs };
  }

  const imageRow = {
    id: IMG,
    productId: PROD,
    publicId: imagePublicId(BIZ, PROD, REQ),
    secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/x.jpg",
    isPrimary: false,
  };

  it("deletes the row on Cloudinary ok", async () => {
    env();
    const { service, txStubs } = serviceWith(
      { id: PROD },
      imageRow,
      destroyFetch({ result: "ok" }),
    );
    const res = await service.removeImage(ctx(), PROD, IMG);
    expect(res).toEqual({ deleted: true, id: IMG });
    expect(txStubs.deleted).toEqual([IMG]);
  });

  it("converges when Cloudinary says not found (already gone)", async () => {
    env();
    const { service, txStubs } = serviceWith(
      { id: PROD },
      imageRow,
      destroyFetch({ result: "not found" }),
    );
    const res = await service.removeImage(ctx(), PROD, IMG);
    expect(res.deleted).toBe(true);
    expect(txStubs.deleted).toEqual([IMG]);
  });

  it("keeps the row when Cloudinary reports an error result", async () => {
    env();
    const { service, txStubs } = serviceWith(
      { id: PROD },
      imageRow,
      destroyFetch({ result: "error", error: { message: "boom" } }),
    );
    await expect(service.removeImage(ctx(), PROD, IMG)).rejects.toThrow(
      "No se pudo eliminar",
    );
    expect(txStubs.deleted).toEqual([]);
  });

  it("keeps the row on Cloudinary HTTP 500", async () => {
    env();
    const { service, txStubs } = serviceWith(
      { id: PROD },
      imageRow,
      destroyFetch({ error: "x" }, 500),
    );
    await expect(service.removeImage(ctx(), PROD, IMG)).rejects.toThrow(
      "No se pudo eliminar",
    );
    expect(txStubs.deleted).toEqual([]);
  });

  it("rejects cross-tenant deletes (product of another business)", async () => {
    env();
    const { service } = serviceWith(null, null, destroyFetch({ result: "ok" }));
    await expect(service.removeImage(ctx(), PROD, IMG)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects images that do not belong to the product", async () => {
    env();
    const prisma = {
      product: { findFirst: async () => ({ id: PROD }) },
      productImage: { findFirst: async () => null },
      $transaction: async () => ({}),
    };
    const service = new MediaService(prisma as never, destroyFetch({ result: "ok" }));
    await expect(service.removeImage(ctx(), PROD, IMG)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
