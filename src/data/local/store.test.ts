import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Dexie from "dexie";
import { LOCAL_DB_NAME, __resetLocalDbForTests, __reopenLocalDbForTests, getLocalDb } from "./db";
import { newEntityId } from "./ids";
import { getLocalStore, resetLocalStoreSingleton } from "./store";
import type { LocalCustomer, LocalProduct } from "./types";

const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIZ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function product(businessId: string, name: string): LocalProduct {
  const now = Date.now();
  return {
    id: newEntityId(),
    businessId,
    name,
    category: "General",
    price: 1000,
    avgCost: 400,
    stock: 10,
    lowStockAt: 5,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    images: [],
  };
}

function customer(businessId: string, name: string): LocalCustomer {
  const now = Date.now();
  return {
    id: newEntityId(),
    businessId,
    code: null,
    name,
    phone: null,
    debt: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe("M6 LocalStore tenant isolation", () => {
  beforeEach(async () => {
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  afterEach(async () => {
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("uses dulcecalle-local, not the legacy ++id database name", async () => {
    const store = getLocalStore();
    await store.products.put(product(BIZ_A, "Galleta"));
    expect(await Dexie.exists(LOCAL_DB_NAME)).toBe(true);
    expect(getLocalDb().name).toBe("dulcecalle-local");
  });

  it("Business A rows are invisible to Business B", async () => {
    const store = getLocalStore();
    const galleta = product(BIZ_A, "Galleta");
    const rosa = customer(BIZ_A, "Rosa");
    await store.products.put(galleta);
    await store.customers.put(rosa);
    await store.products.put(product(BIZ_B, "Chicle"));

    const aProducts = await store.products.list(BIZ_A);
    const bProducts = await store.products.list(BIZ_B);
    expect(aProducts.map((p) => p.name)).toEqual(["Galleta"]);
    expect(bProducts.map((p) => p.name)).toEqual(["Chicle"]);
    expect(await store.products.get(BIZ_B, galleta.id)).toBeUndefined();
    expect(await store.customers.get(BIZ_B, rosa.id)).toBeUndefined();
    expect(await store.customers.get(BIZ_A, rosa.id)).toMatchObject({
      name: "Rosa",
      code: null,
    });
  });

  it("refuses to overwrite a Business A id with a Business B row", async () => {
    const store = getLocalStore();
    const galleta = product(BIZ_A, "Galleta");
    await store.products.put(galleta);
    await expect(
      store.products.put({ ...galleta, businessId: BIZ_B, name: "Chicle" }),
    ).rejects.toThrow(/another business/);
    expect((await store.products.get(BIZ_A, galleta.id))?.name).toBe("Galleta");
    expect(await store.products.get(BIZ_B, galleta.id)).toBeUndefined();
  });

  it("rejects numeric Dexie ids", async () => {
    const store = getLocalStore();
    await expect(
      store.products.put({
        ...product(BIZ_A, "X"),
        id: 381 as unknown as string,
      }),
    ).rejects.toThrow(/UUID/);
  });

  it("persists across a simulated reload", async () => {
    const store = getLocalStore();
    const row = product(BIZ_A, "Galleta");
    await store.products.put(row);
    resetLocalStoreSingleton();
    __reopenLocalDbForTests();
    const reopened = getLocalStore();
    const got = await reopened.products.get(BIZ_A, row.id);
    expect(got?.name).toBe("Galleta");
    expect(got?.stock).toBe(10);
  });
});
