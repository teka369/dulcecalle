import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/data/errors";
import { __resetLocalDbForTests } from "@/data/local/db";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { resetCatalogReadCache } from "@/data/local/read-cache";

const BIZ = "11111111-1111-4111-8111-111111111111";
const CUS = { id: "33333333-3333-4333-8333-333333333333", name: "Rosa", code: "C1", phone: null, debt: 100, archivedAt: null, createdAt: 1 };
const PROD = { id: "22222222-2222-4222-8222-222222222222", name: "Gomitas", category: "General", price: 1, avgCost: 1, stock: 1, lowStockAt: 0, sellable: true, archivedAt: null, createdAt: 1, images: [] };

const api = {
  session: { businessId: BIZ },
  customers: { list: vi.fn() },
  products: { list: vi.fn() },
  suppliers: { list: vi.fn() },
};
vi.mock("@/data/pwa/api", () => ({ getPwaApi: () => api, getPrepPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

import { customerStore } from "./customerStore";
import { inventoryStore } from "./inventoryStore";

const boom = () => new ApiError("INTERNAL", "Algo salió mal.", 503);

describe("B3: Clientes/Inventario stores on 5xx", () => {
  beforeEach(async () => {
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
  });

  it("customers: local data + cache source after 5xx; error status (not empty) without local data", async () => {
    api.customers.list.mockRejectedValueOnce(boom());
    await expect(customerStore.refresh()).rejects.toThrow();
    expect(customerStore.getSnapshot().listStatus.error).toBeTruthy();
    expect(customerStore.getSnapshot().customers).toEqual([]);

    api.customers.list.mockResolvedValueOnce([CUS]);
    await customerStore.refresh();
    expect(customerStore.getSnapshot().listStatus).toMatchObject({ source: "server", error: null });

    api.customers.list.mockRejectedValueOnce(boom());
    await customerStore.refresh();
    expect(customerStore.getSnapshot().customers.map((c) => c.id)).toEqual([CUS.id]);
    expect(customerStore.getSnapshot().listStatus.source).toBe("cache");
  });

  it("products: 5xx with local data shows them labeled cache; suppliers failing does not hide products", async () => {
    api.products.list.mockResolvedValueOnce([PROD]);
    api.suppliers.list.mockResolvedValueOnce([]);
    await inventoryStore.refreshAll();
    api.products.list.mockRejectedValueOnce(boom());
    api.suppliers.list.mockRejectedValueOnce(boom());
    await inventoryStore.refreshAll();
    expect(inventoryStore.getSnapshot().products.map((p) => p.id)).toEqual([PROD.id]);
    expect(inventoryStore.getSnapshot().listStatus.source).toBe("cache");
  });
});
