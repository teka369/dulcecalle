import { describe, expect, it, vi } from "vitest";

const local = [{ id: "c1", name: "Rosa", code: "C1", phone: null, debt: 12000, archivedAt: null, createdAt: 1 }];
let releaseServer: (v: unknown) => void = () => undefined;

vi.mock("@/data/pwa/catalog", () => ({
  peekLocalCustomers: vi.fn(async () => local),
  peekLocalProducts: vi.fn(async () => null),
  peekLocalSuppliers: vi.fn(async () => null),
  listCachedCustomersResult: vi.fn(() => new Promise((ok) => (releaseServer = ok))),
  listCachedProductsResult: vi.fn(() => new Promise(() => undefined)),
  listCachedSuppliersResult: vi.fn(() => new Promise(() => undefined)),
  getCachedCustomer: vi.fn(),
  getCachedProduct: vi.fn(),
  getCachedSupplier: vi.fn(),
}));

describe("hero-first paint during a slow load", () => {
  it("customers: local rows paint while the server is slow; server then wins", async () => {
    const { customerStore } = await import("./customerStore");
    const done = customerStore.refresh();
    await vi.waitFor(() => expect(customerStore.getSnapshot().customers).toEqual(local));
    expect(customerStore.getSnapshot().loading).toBe(true);
    expect(customerStore.getSnapshot().listStatus.source).toBeNull();
    releaseServer({ data: [], source: "server", cachedAt: 2 });
    await done;
    expect(customerStore.getSnapshot().customers).toEqual([]);
    expect(customerStore.getSnapshot().listStatus.source).toBe("server");
  });

  it("inventory: nothing local keeps products empty+loading (hero shows skeleton, not 0)", async () => {
    const { inventoryStore } = await import("./inventoryStore");
    void inventoryStore.refreshAll().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(inventoryStore.getSnapshot().products).toEqual([]);
    expect(inventoryStore.getSnapshot().loading).toBe(true);
  });
});
