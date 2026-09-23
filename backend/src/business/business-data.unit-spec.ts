import { BusinessDataService } from "./business-data.service";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, string>;

function fkError(): Error {
  // Mirrors PostgreSQL RESTRICT: products cannot be removed while
  // product_images rows reference them (P2003).
  return Object.assign(
    new Error(
      'Foreign key violation on "product_images_product_id_fkey"',
    ),
    { code: "P2003" },
  );
}

/**
 * In-memory Prisma double that enforces the REAL FK rule:
 * product.deleteMany throws while any productImage of the same business
 * still references a deleted product.
 */
function fakePrisma(seedImages: Row[] = [{ businessId: BIZ, productId: "p1", publicId: `dulcecalle/${BIZ}/products/p1/r1` }]) {
  const images = [...seedImages];
  const products = [{ businessId: BIZ, id: "p1" }];
  const preparations: Row[] = [{ businessId: BIZ, sourceId: "p0", targetId: "p1" }];
  const calls: string[] = [];
  const table = (name: string, extra?: { onDeleteProducts?: () => void }) => ({
    findMany: async (args: { where: { businessId: string }; select?: Record<string, boolean> }) => {
      calls.push(`${name}.findMany`);
      if (name === "customer") return [];
      if (name === "productImage") {
        const rows = images.filter((r) => r.businessId === args.where.businessId);
        if (args.select && Object.keys(args.select).length === 1 && args.select.publicId) {
          return rows.map((r) => ({ publicId: r.publicId }));
        }
        return rows;
      }
      return [];
    },
    deleteMany: async (args: { where: { businessId: string } }) => {
      calls.push(`${name}.deleteMany`);
      const biz = args.where.businessId;
      if (name === "product" && extra?.onDeleteProducts) {
        extra.onDeleteProducts();
      }
      if (name === "product") {
        const removed = products.filter((p) => p.businessId === biz).map((p) => p.id);
        const blocking = images.filter(
          (img) => img.businessId === biz && removed.includes(img.productId),
        );
        const blockingPrep = preparations.filter(
          (r) =>
            r.businessId === biz &&
            (removed.includes(r.sourceId ?? "") || removed.includes(r.targetId ?? "")),
        );
        if (blocking.length > 0 || blockingPrep.length > 0) throw fkError();
        for (let i = products.length - 1; i >= 0; i--) {
          if (products[i]?.businessId === biz) products.splice(i, 1);
        }
        return { count: removed.length };
      }
      if (name === "productImage") {
        let count = 0;
        for (let i = images.length - 1; i >= 0; i--) {
          if (images[i]?.businessId === biz) {
            images.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      }
      if (name === "preparation") {
        let count = 0;
        for (let i = preparations.length - 1; i >= 0; i--) {
          if (preparations[i]?.businessId === biz) {
            preparations.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      }
      return { count: 0 };
    },
  });
  const tx = {
    customer: table("customer"),
    saleReturnLine: table("saleReturnLine"),
    saleReturn: table("saleReturn"),
    saleLine: table("saleLine"),
    sale: table("sale"),
    customerPayment: table("customerPayment"),
    initialDebt: table("initialDebt"),
    stockMove: table("stockMove"),
    cashMove: table("cashMove"),
    cashSession: table("cashSession"),
    expense: table("expense"),
    supplier: table("supplier"),
    product: table("product"),
    productImage: table("productImage"),
    preparation: table("preparation"),
    setting: table("setting"),
    importIdMap: table("importIdMap"),
  };
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    __preparations: preparations,
    __state: { images, products, preparations, calls },
  };
}

function ctx() {
  return {
    userId: "u1",
    businessId: BIZ,
    role: "owner",
    timezone: "America/Bogota",
  } as never;
}

function service(prisma: unknown, media: unknown): BusinessDataService {
  return new BusinessDataService(prisma as never, media as never);
}

function okMedia(destroyed = 1) {
  return {
    destroyAssets: async (businessId: string, publicIds: string[]) => {
      expect(businessId).toBe(BIZ);
      expect(publicIds).toEqual([`dulcecalle/${BIZ}/products/p1/r1`]);
      return { destroyed, failed: 0 };
    },
  };
}

describe("BusinessDataService.resetData", () => {
  it("reproduces the production failure: products with images violate RESTRICT", async () => {
    const prisma = fakePrisma();
    // Simulates the pre-fix code path (products wiped without wiping
    // productImages first): run only the product wipe to prove the FK rule.
    await expect(
      prisma.$transaction(async (tx: unknown) => {
        const t = tx as unknown as {
          product: { deleteMany: (args: unknown) => Promise<unknown> };
        };
        await t.product.deleteMany({ where: { businessId: BIZ } });
      }),
    ).rejects.toThrow(/Foreign key violation/);
    expect(prisma.__state.images).toHaveLength(1);
    expect(prisma.__state.products).toHaveLength(1);
  });

  it("wipes images before products and destroys Cloudinary assets", async () => {
    const prisma = fakePrisma();
    const media = okMedia();
    const svc = service(prisma, media);
    const result = await svc.resetData(ctx());
    expect(result.deleted.productImages).toBe(1);
    expect(result.deleted.preparations).toBe(1);
    expect(result.deleted.products).toBe(1);
    expect(result.deletedCustomerIds).toEqual([]);
    expect(result.cloudinary).toEqual({ destroyed: 1, failed: 0 });
    expect(prisma.__state.images).toHaveLength(0);
    expect(prisma.__state.preparations).toHaveLength(0);
    expect(prisma.__state.products).toHaveLength(0);
    // FK-safe order: images and preparations deleted before products.
    const order = prisma.__state.calls.filter((c) =>
      c.startsWith("product") || c.startsWith("preparation"),
    );
    expect(order).toEqual([
      "productImage.findMany",
      "productImage.deleteMany",
      "preparation.deleteMany",
      "product.deleteMany",
    ]);
  });

  it("succeeds on a business without images", async () => {
    const prisma = fakePrisma([]);
    const destroyed: string[][] = [];
    const media = {
      destroyAssets: async (_biz: string, ids: string[]) => {
        destroyed.push(ids);
        return { destroyed: 0, failed: 0 };
      },
    };
    const svc = service(prisma, media);
    const result = await svc.resetData(ctx());
    expect(result.deletedCustomerIds).toEqual([]);
    expect(result.deleted.products).toBe(1);
    expect(destroyed).toEqual([]);
  });

  it("never touches another business", async () => {
    const prisma = fakePrisma([
      { businessId: BIZ, productId: "p1", publicId: `dulcecalle/${BIZ}/products/p1/r1` },
      { businessId: OTHER, productId: "p9", publicId: `dulcecalle/${OTHER}/products/p9/r9` },
    ]);
    const seen: string[][] = [];
    const media = {
      destroyAssets: async (biz: string, ids: string[]) => {
        seen.push([biz, ...ids]);
        return { destroyed: ids.length, failed: 0 };
      },
    };
    const svc = service(prisma, media);
    await svc.resetData(ctx());
    expect(prisma.__state.images).toEqual([
      { businessId: OTHER, productId: "p9", publicId: `dulcecalle/${OTHER}/products/p9/r9` },
    ]);
    expect(seen).toEqual([[BIZ, `dulcecalle/${BIZ}/products/p1/r1`]]);
  });

  it("Cloudinary failure never fails the reset", async () => {
    const prisma = fakePrisma();
    const media = {
      destroyAssets: async () => {
        throw new Error("cloudinary down");
      },
    };
    const svc = service(prisma, media);
    const result = await svc.resetData(ctx());
    expect(result.deleted.products).toBe(1);
    expect(result.cloudinary).toEqual({ destroyed: 0, failed: 0 });
    expect(prisma.__state.products).toHaveLength(0);
  });
});
