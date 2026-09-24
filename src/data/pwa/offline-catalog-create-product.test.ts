import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import {
  __resetLocalDbForTests,
  getLocalDb,
} from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";

const businessId = "11111111-1111-4111-8111-111111111111";

const api = {
  session: { businessId },
  products: {
    create: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    archive: vi.fn(),
  },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));

import {
  createProductWithOfflineFallback,
  openingStoredAvgCost,
  syncPendingProducts,
} from "./offline-catalog";

function offlineProductId(
  result: Awaited<ReturnType<typeof createProductWithOfflineFallback>>,
): string {
  expect(result.mode).toBe("offline");
  if (result.mode !== "offline") throw new Error("expected offline");
  return result.productId;
}

describe("M1 offline product create", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = businessId;
  });

  afterEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("openingStoredAvgCost matches sellable unit vs combo lot pool", () => {
    expect(
      openingStoredAvgCost({ sellable: true, stock: 2, unitCost: 50_000 }),
    ).toBe(50_000);
    expect(
      openingStoredAvgCost({ sellable: false, stock: 2, unitCost: 50_000 }),
    ).toBe(100_000);
    expect(
      openingStoredAvgCost({ sellable: false, stock: 0, unitCost: 50_000 }),
    ).toBe(0);
  });

  it("creates a product online without touching the outbox", async () => {
    const remote = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Gomitas",
      category: "General",
      price: 2000,
      avgCost: 500,
      stock: 10,
      lowStockAt: 5,
      sellable: true,
      archivedAt: null,
      createdAt: Date.now(),
      images: [],
    };
    api.products.create.mockResolvedValue(remote);
    const result = await createProductWithOfflineFallback(
      { name: "Gomitas", price: 2000, stock: 10, avgCost: 500, sellable: true },
      "33333333-3333-4333-8333-333333333333",
    );
    expect(result).toEqual({ mode: "online", product: remote });
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect(api.products.create).toHaveBeenCalledWith(
      {
        name: "Gomitas",
        price: 2000,
        stock: 10,
        avgCost: 500,
        lowStockAt: 5,
        gifted: false,
        sellable: true,
      },
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("creates a combo/insumo online with sellable false", async () => {
    const remote = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Combo",
      category: "General",
      price: 0,
      avgCost: 100_000,
      stock: 2,
      lowStockAt: 5,
      sellable: false,
      archivedAt: null,
      createdAt: Date.now(),
      images: [],
    };
    api.products.create.mockResolvedValue(remote);
    const result = await createProductWithOfflineFallback(
      {
        name: "Combo",
        price: 0,
        stock: 2,
        avgCost: 50_000,
        sellable: false,
      },
      "44444444-4444-4444-8444-444444444444",
    );
    expect(result.mode).toBe("online");
    expect(api.products.create).toHaveBeenCalledWith(
      expect.objectContaining({ sellable: false, avgCost: 50_000, stock: 2 }),
      "44444444-4444-4444-8444-444444444444",
    );
  });

  it("enqueues outbox on NetworkError while intending online create", async () => {
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    const requestId = "55555555-5555-4555-8555-555555555555";
    const result = await createProductWithOfflineFallback(
      { name: "Gomitas", price: 2000, stock: 4, avgCost: 500 },
      requestId,
    );
    const productId = offlineProductId(result);
    const row = await getLocalDb().products.get(productId);
    expect(row).toMatchObject({
      id: productId,
      businessId,
      name: "Gomitas",
      price: 2000,
      stock: 4,
      avgCost: 500,
      sellable: true,
      requestId,
    });
    const outbox = await getLocalDb().outbox.where("businessId").equals(businessId).toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity: "product",
      operation: "create",
      requestId,
      status: "pending",
    });
    expect(outbox[0].payload).toEqual({
      name: "Gomitas",
      price: 2000,
      stock: 4,
      avgCost: 500,
      lowStockAt: 5,
      gifted: false,
      sellable: true,
    });
    expect(outbox[0].payload).not.toHaveProperty("id");
    expect(outbox[0].payload).not.toHaveProperty("productId");
    expect(outbox[0].payload).not.toHaveProperty("kind");
  });

  it("offline combo stores lot pool avgCost but posts unit cost", async () => {
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    const requestId = "66666666-6666-4666-8666-666666666666";
    const productId = offlineProductId(
      await createProductWithOfflineFallback(
        {
          name: "Insumo",
          price: 0,
          stock: 2,
          avgCost: 50_000,
          sellable: false,
        },
        requestId,
      ),
    );
    const row = await getLocalDb().products.get(productId);
    expect(row?.avgCost).toBe(100_000);
    expect(row?.sellable).toBe(false);
    const op = (await getOutboxStore().listPending(businessId))[0];
    expect(op.payload).toMatchObject({
      avgCost: 50_000,
      sellable: false,
      stock: 2,
    });
  });

  it("offline combo with no stock stores avgCost 0", async () => {
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    const productId = offlineProductId(
      await createProductWithOfflineFallback(
        {
          name: "Insumo vacío",
          price: 0,
          stock: 0,
          avgCost: 50_000,
          sellable: false,
        },
        "77777777-7777-4777-8777-777777777777",
      ),
    );
    expect((await getLocalDb().products.get(productId))?.avgCost).toBe(0);
  });

  it("does not enqueue validation errors", async () => {
    await expect(
      createProductWithOfflineFallback(
        { name: "   ", price: 100 },
        "88888888-8888-4888-8888-888888888888",
      ),
    ).rejects.toThrow("El nombre es obligatorio.");
    await expect(
      createProductWithOfflineFallback(
        { name: "X", price: -1 },
        "99999999-9999-4999-8999-999999999999",
      ),
    ).rejects.toThrow("Revisa el costo.");
    await expect(
      createProductWithOfflineFallback(
        { name: "X", price: 100, stock: 2, avgCost: 0 },
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    ).rejects.toThrow("Si hay stock, ponle lo que te costó.");
    expect(api.products.create).not.toHaveBeenCalled();
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect(await getLocalDb().products.count()).toBe(0);
  });

  it("does not fallback for HTTP validation/auth errors", async () => {
    api.products.create.mockRejectedValue(new ApiError("VALIDATION", "Bad", 400));
    await expect(
      createProductWithOfflineFallback(
        { name: "X", price: 100 },
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ),
    ).rejects.toThrow("Bad");
    expect(await getLocalDb().outbox.count()).toBe(0);
  });

  it("preserves requestId on retry (idempotent local intention)", async () => {
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const first = await createProductWithOfflineFallback(
      { name: "Gomitas", price: 1000 },
      requestId,
    );
    const second = await createProductWithOfflineFallback(
      { name: "Gomitas", price: 1000 },
      requestId,
    );
    expect(offlineProductId(second)).toBe(offlineProductId(first));
    expect(await getLocalDb().outbox.count()).toBe(1);
  });

  it("syncs create with same requestId and remaps local UUID to server UUID", async () => {
    api.products.create.mockRejectedValueOnce(new NetworkError("offline"));
    const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const local = await createProductWithOfflineFallback(
      { name: "Gomitas", price: 2000, stock: 3, avgCost: 400 },
      requestId,
    );
    const localId = offlineProductId(local);
    const remote = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      name: "Gomitas",
      category: "General",
      price: 2000,
      avgCost: 400,
      stock: 3,
      lowStockAt: 5,
      sellable: true,
      archivedAt: null,
      createdAt: Date.now(),
      images: [],
    };
    api.products.create.mockResolvedValue(remote);
    api.products.get.mockResolvedValue(remote);

    await getLocalDb().pendingMedia.put({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      businessId,
      productId: localId,
      requestId: "12121212-1212-4121-8121-121212121212",
      fileName: "a.jpg",
      mime: "image/jpeg",
      size: 10,
      blob: new Blob(["x"]),
      position: null,
      isPrimary: false,
      altText: null,
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: Date.now(),
    });

    const flush = await syncPendingProducts(businessId);
    expect(flush.synced).toBe(1);
    expect(api.products.create).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: "Gomitas", avgCost: 400 }),
      requestId,
    );
    expect(await getLocalDb().products.get(localId)).toBeUndefined();
    expect(await getLocalDb().products.get(remote.id)).toMatchObject({
      id: remote.id,
      businessId,
      name: "Gomitas",
    });
    expect(
      (await getLocalDb().pendingMedia.get("ffffffff-ffff-4fff-8fff-ffffffffffff"))
        ?.productId,
    ).toBe(remote.id);
  });

  it("retrying a synced create does not duplicate", async () => {
    api.products.create.mockRejectedValueOnce(new NetworkError("offline"));
    const requestId = "13131313-1313-4131-8131-131313131313";
    await createProductWithOfflineFallback(
      { name: "Gomitas", price: 1000 },
      requestId,
    );
    const remote = {
      id: "14141414-1414-4141-8141-141414141414",
      name: "Gomitas",
      category: "General",
      price: 1000,
      avgCost: 0,
      stock: 0,
      lowStockAt: 5,
      sellable: true,
      archivedAt: null,
      createdAt: Date.now(),
      images: [],
    };
    api.products.create.mockResolvedValue(remote);
    api.products.get.mockResolvedValue(remote);
    api.products.create.mockClear();
    await syncPendingProducts(businessId);
    await syncPendingProducts(businessId);
    expect(api.products.create).toHaveBeenCalledTimes(1);
  });
});
