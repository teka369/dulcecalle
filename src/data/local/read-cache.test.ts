import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { ApiError, NetworkError } from "../errors";
import type { RemoteCustomer, RemoteProduct, RemoteSupplier } from "../http/mappers";
import { LOCAL_DB_NAME, __reopenLocalDbForTests, __resetLocalDbForTests, getLocalDb } from "./db";
import { newEntityId } from "./ids";
import { getOutboxStore } from "./outbox";
import {
  CatalogReadCache,
  resetCatalogReadCache,
} from "./read-cache";
import { getLocalStore, resetLocalStoreSingleton } from "./store";

const BIZ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BIZ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PID_A = "11111111-1111-4111-8111-111111111111";
const PID_B = "22222222-2222-4222-8222-222222222222";
const CID_A = "33333333-3333-4333-8333-333333333333";
const SID_A = "44444444-4444-4444-8444-444444444444";

function product(over: Partial<RemoteProduct> = {}): RemoteProduct {
  return {
    id: PID_A,
    name: "Galleta",
    category: "General",
    price: 1000,
    avgCost: 400,
    stock: 10,
    lowStockAt: 5,
    archivedAt: null,
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

function customer(over: Partial<RemoteCustomer> = {}): RemoteCustomer {
  return {
    id: CID_A,
    name: "Rosa",
    code: "DC-0001",
    phone: null,
    debt: 2500,
    archivedAt: null,
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

function supplier(over: Partial<RemoteSupplier> = {}): RemoteSupplier {
  return {
    id: SID_A,
    name: "Mayorista",
    phone: null,
    notes: null,
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

function cache(): CatalogReadCache {
  return new CatalogReadCache(getLocalStore(), getLocalDb());
}

describe("M6.3 catalog read cache", () => {
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

  it("1-4. online GET updates cache; offline GET returns it after reload", async () => {
    const first = cache();
    const online = await first.listProducts(BIZ_A, async () => [product()]);
    expect(online.source).toBe("server");
    expect(online.data).toEqual([product()]);

    resetCatalogReadCache();
    resetLocalStoreSingleton();
    __reopenLocalDbForTests();

    const reloaded = cache();
    const offline = await reloaded.listProducts(BIZ_A, async () => {
      throw new NetworkError();
    });
    expect(offline.source).toBe("cache");
    expect(offline.data).toEqual([product()]);
    expect(offline.cachedAt).toBeTypeOf("number");
  });

  it("5. NetworkError falls back to cache", async () => {
    const c = cache();
    await c.listCustomers(BIZ_A, async () => [customer()]);
    const again = await c.listCustomers(BIZ_A, async () => {
      throw new NetworkError("Sin conexión.");
    });
    expect(again.source).toBe("cache");
    expect(again.data[0]?.name).toBe("Rosa");
    expect(again.data[0]?.debt).toBe(2500);
  });

  it("6. NetworkError without cache keeps the error", async () => {
    const err = new NetworkError();
    await expect(
      cache().listProducts(BIZ_A, async () => {
        throw err;
      }),
    ).rejects.toBe(err);
  });

  it("7. 401/403 do not fall back to cache", async () => {
    const c = cache();
    await c.listProducts(BIZ_A, async () => [product()]);
    const unauthorized = new ApiError("UNAUTHORIZED", "Inicia sesión.", 401);
    await expect(
      c.listProducts(BIZ_A, async () => {
        throw unauthorized;
      }),
    ).rejects.toBe(unauthorized);
    const forbidden = new ApiError("FORBIDDEN", "No puedes.", 403);
    await expect(
      c.listProducts(BIZ_A, async () => {
        throw forbidden;
      }),
    ).rejects.toBe(forbidden);
  });

  it("8. 5xx does not fall back to cache — server answered, it is still the authority", async () => {
    const c = cache();
    await c.listProducts(BIZ_A, async () => [product()]);
    const boom = new ApiError("INTERNAL", "Algo salió mal.", 500);
    await expect(
      c.listProducts(BIZ_A, async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("9-10. Business B cannot read Business A cache; ids do not mix", async () => {
    const c = cache();
    await c.listProducts(BIZ_A, async () => [product({ id: PID_A, name: "Galleta" })]);
    await c.listProducts(BIZ_B, async () => [
      product({ id: PID_B, name: "Chicle", price: 500, avgCost: 200, stock: 3 }),
    ]);

    const a = await c.listProducts(BIZ_A, async () => {
      throw new NetworkError();
    });
    const b = await c.listProducts(BIZ_B, async () => {
      throw new NetworkError();
    });
    expect(a.data.map((p) => p.name)).toEqual(["Galleta"]);
    expect(b.data.map((p) => p.name)).toEqual(["Chicle"]);
    expect(a.data[0]?.id).toBe(PID_A);
    expect(b.data[0]?.id).toBe(PID_B);

    await expect(
      getLocalStore().products.replaceAll(BIZ_B, [
        {
          id: PID_A,
          businessId: BIZ_B,
          name: "Stolen",
          category: "General",
          price: 1,
          avgCost: 1,
          stock: 1,
          lowStockAt: 0,
          archivedAt: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ).rejects.toThrow(/another business/);
  });

  it("11-13. later GET replaces the snapshot; no duplicates; businessId stays", async () => {
    const c = cache();
    await c.listProducts(BIZ_A, async () => [
      product({ name: "Galleta", stock: 10 }),
      product({ id: PID_B, name: "Viejo", stock: 1, avgCost: 100, price: 200 }),
    ]);
    const updated = await c.listProducts(BIZ_A, async () => [
      product({ name: "Galleta", stock: 4 }),
    ]);
    expect(updated.source).toBe("server");
    expect(updated.data).toHaveLength(1);
    expect(updated.data[0]?.stock).toBe(4);

    const offline = await c.listProducts(BIZ_A, async () => {
      throw new NetworkError();
    });
    expect(offline.data).toHaveLength(1);
    expect(offline.data[0]?.stock).toBe(4);
    const rows = await getLocalStore().products.list(BIZ_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.businessId).toBe(BIZ_A);
    expect(rows.map((r) => r.id)).not.toContain(PID_B);
  });

  it("empty server list is a real snapshot, not 'no cache'", async () => {
    const c = cache();
    const empty = await c.listSuppliers(BIZ_A, async () => []);
    expect(empty.data).toEqual([]);
    expect(empty.source).toBe("server");
    const offline = await c.listSuppliers(BIZ_A, async () => {
      throw new NetworkError();
    });
    expect(offline.source).toBe("cache");
    expect(offline.data).toEqual([]);
  });

  it("14. uses dulcecalle-local, never the legacy ++id database", async () => {
    await cache().listProducts(BIZ_A, async () => [product()]);
    expect(getLocalDb().name).toBe(LOCAL_DB_NAME);
    expect(await Dexie.exists(LOCAL_DB_NAME)).toBe(true);
    expect(await Dexie.exists("dulcecalle")).toBe(false);
  });

  it("15. GET cache does not enqueue outbox operations", async () => {
    await cache().listProducts(BIZ_A, async () => [product()]);
    await cache().listCustomers(BIZ_A, async () => [customer()]);
    await cache().listSuppliers(BIZ_A, async () => [supplier()]);
    expect(await getOutboxStore().listPending(BIZ_A)).toEqual([]);
    expect(
      await getLocalDb().outbox.where("businessId").equals(BIZ_A).count(),
    ).toBe(0);
  });

  it("get-by-id upserts one row; NetworkError reads it", async () => {
    const c = cache();
    const row = await c.getProduct(BIZ_A, PID_A, async () => product());
    expect(row.name).toBe("Galleta");
    const offline = await c.getProduct(BIZ_A, PID_A, async () => {
      throw new NetworkError();
    });
    expect(offline.stock).toBe(10);
    await expect(
      c.getProduct(BIZ_A, newEntityId(), async () => {
        throw new NetworkError();
      }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("TypeError Failed to fetch is treated as NetworkError fallback", async () => {
    const c = cache();
    await c.listProducts(BIZ_A, async () => [product()]);
    const offline = await c.listProducts(BIZ_A, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(offline.source).toBe("cache");
  });
});
