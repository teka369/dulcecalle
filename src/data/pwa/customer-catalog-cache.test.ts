import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { getCustomerAuthSession } from "@/data/http/customer-session";
import {
  loadCachedCustomerCatalog,
  primaryCatalogImage,
} from "./customer-catalog-cache";

const CUSTOMER_A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "DC-0001", name: "Rosa" };
const CUSTOMER_B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", code: "DC-0002", name: "Luis" };

const api = {
  products: vi.fn(),
};

vi.mock("../http/customer-api", () => ({
  getCustomerApi: () => ({ products: api.products }),
}));

function product(id: string, name = "Gomitas") {
  return {
    id,
    name,
    price: 500,
    available: true,
    images: [
      { id: "img-1", secureUrl: "https://res.cloudinary.com/demo/image/upload/a.jpg", position: 1, isPrimary: false, altText: null },
      { id: "img-2", secureUrl: "https://res.cloudinary.com/demo/image/upload/b.jpg", position: 0, isPrimary: true, altText: null },
    ],
  };
}

describe("customer catalog cache", () => {
  beforeEach(async () => {
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    getCustomerAuthSession().customer = { ...CUSTOMER_A };
  });

  it("caches the online catalog and serves it offline", async () => {
    api.products.mockResolvedValue([product("p1")]);
    const first = await loadCachedCustomerCatalog();
    expect(first.source).toBe("server");
    api.products.mockRejectedValue(new NetworkError("offline"));
    const cached = await loadCachedCustomerCatalog();
    expect(cached.source).toBe("cache");
    expect(cached.products).toHaveLength(1);
    expect(cached.capturedAt).toBe(first.capturedAt);
  });

  it("isolates customers: B never reads A", async () => {
    api.products.mockResolvedValue([product("p1")]);
    await loadCachedCustomerCatalog();
    getCustomerAuthSession().customer = { ...CUSTOMER_B };
    api.products.mockRejectedValue(new NetworkError("offline"));
    await expect(loadCachedCustomerCatalog()).rejects.toThrow();
  });

  it("rethrows HTTP errors instead of serving cache", async () => {
    api.products.mockResolvedValue([product("p1")]);
    await loadCachedCustomerCatalog();
    const err = new ApiError("INTERNAL", "Falla.", 500);
    api.products.mockRejectedValue(err);
    await expect(loadCachedCustomerCatalog()).rejects.toBe(err);
  });

  it("resolves the primary image with position fallback", () => {
    const [p] = [product("p1")];
    expect(primaryCatalogImage(p!)?.id).toBe("img-2");
    const noPrimary = { ...p!, images: p!.images.map((i) => ({ ...i, isPrimary: false })) };
    expect(primaryCatalogImage(noPrimary)?.id).toBe("img-2");
    expect(primaryCatalogImage({ ...p!, images: [] })).toBeNull();
  });
});
