import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RemoteCustomer, RemoteProduct } from "../http/mappers";
import { __resetLocalDbForTests, getLocalDb } from "./db";
import { CatalogReadCache, resetCatalogReadCache } from "./read-cache";
import { getLocalStore, resetLocalStoreSingleton } from "./store";

const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const cus: RemoteCustomer = { id: "33333333-3333-4333-8333-333333333333", name: "Rosa", code: "DC-0001", phone: null, debt: 2500, archivedAt: null, createdAt: 1 };
const prod: RemoteProduct = { images: [], id: "11111111-1111-4111-8111-111111111111", name: "Galleta", category: "General", price: 1000, avgCost: 400, stock: 1, lowStockAt: 5, sellable: true, archivedAt: null, createdAt: 1 };

const cache = () => new CatalogReadCache(getLocalStore(), getLocalDb());

describe("hero-first peek (local figures while a slow load runs)", () => {
  beforeEach(async () => {
    resetCatalogReadCache();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });
  afterEach(async () => {
    resetCatalogReadCache();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("never-cached resource peeks null (skeleton), not an empty list (fake 0)", async () => {
    expect(await cache().peekCustomers(BIZ)).toBeNull();
    expect(await cache().peekProducts(BIZ)).toBeNull();
    expect(await cache().peekSuppliers(BIZ)).toBeNull();
  });

  it("returns this device's rows without calling the server, scoped by business", async () => {
    const c = cache();
    await c.listCustomers(BIZ, async () => [cus]);
    await c.listProducts(BIZ, async () => [prod]);
    expect(await c.peekCustomers(BIZ)).toEqual([cus]);
    expect(await c.peekProducts(BIZ)).toEqual([prod]);
    expect(await c.peekCustomers(OTHER)).toBeNull();
  });

  it("a cached-but-empty list peeks [] (a real 0)", async () => {
    const c = cache();
    await c.listCustomers(BIZ, async () => []);
    expect(await c.peekCustomers(BIZ)).toEqual([]);
  });
});
