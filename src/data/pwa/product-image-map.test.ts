import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { resetLocalStoreSingleton } from "@/data/local/store";
import {
  loadPortalImageMap,
  loadProductImageMap,
} from "./product-image-map";

const BIZ_A = "11111111-1111-4111-8111-111111111111";
const BIZ_B = "22222222-2222-4222-8222-222222222222";
const PROD_A = "33333333-3333-4333-8333-333333333333";
const PROD_B = "44444444-4444-4333-8333-444444444444";

function image(id: string, productId: string, primary: boolean, position: number) {
  return {
    id,
    productId,
    publicId: `dulcecalle/biz/products/${productId}/${id}`,
    secureUrl: `https://res.cloudinary.com/demo/image/upload/v1/${id}.jpg`,
    version: 1,
    width: 100,
    height: 100,
    format: "jpg",
    bytes: 500,
    position,
    isPrimary: primary,
    altText: null,
    createdAt: Date.now(),
  };
}

async function seedProduct(
  businessId: string,
  id: string,
  images: ReturnType<typeof image>[],
) {
  const now = Date.now();
  await getLocalDb().products.put({
    id,
    businessId,
    name: "Gomitas",
    category: "General",
    price: 500,
    avgCost: 100,
    stock: 10,
    lowStockAt: 5,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    images,
  });
}

vi.mock("@/data/http/customer-session", () => ({
  getCustomerAuthSession: () => ({
    customer: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "DC-1", name: "R" },
  }),
}));

describe("product image maps", () => {
  beforeEach(async () => {
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("resolves primary urls and null for imageless products", async () => {
    await seedProduct(BIZ_A, PROD_A, [
      image("i1", PROD_A, false, 1),
      image("i2", PROD_A, true, 5),
    ]);
    await seedProduct(BIZ_A, PROD_B, []);
    const map = await loadProductImageMap(BIZ_A);
    expect(map.get(PROD_A)).toContain("i2.jpg");
    expect(map.get(PROD_B)).toBeNull();
    expect(map.get("55555555-5555-4555-8555-555555555555")).toBeUndefined();
  });

  it("never leaks another business catalog", async () => {
    await seedProduct(BIZ_B, PROD_A, [image("i9", PROD_A, true, 0)]);
    const map = await loadProductImageMap(BIZ_A);
    expect(map.has(PROD_A)).toBe(false);
  });

  it("returns an empty map when the store is unreadable", async () => {
    const map = await loadProductImageMap("66666666-6666-4666-8666-666666666666");
    expect(map.size).toBe(0);
  });

  it("portal map resolves from the cached catalog snapshot", async () => {
    await getLocalDb().portalCatalogs.put({
      customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      products: [
        {
          id: PROD_A,
          name: "Gomitas",
          price: 500,
          available: true,
          images: [
            { id: "i1", secureUrl: "https://cdn/a.jpg", position: 1, isPrimary: false, altText: null },
            { id: "i2", secureUrl: "https://cdn/b.jpg", position: 0, isPrimary: true, altText: null },
          ],
        },
        { id: PROD_B, name: "Sin foto", price: 100, available: false, images: [] },
      ],
      capturedAt: Date.now(),
    });
    const map = await loadPortalImageMap();
    expect(map.get(PROD_A)).toBe("https://cdn/b.jpg");
    expect(map.get(PROD_B)).toBeNull();
  });

  it("portal map is empty without a snapshot", async () => {
    const map = await loadPortalImageMap();
    expect(map.size).toBe(0);
  });
});
