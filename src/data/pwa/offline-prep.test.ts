import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { getPwaAuthSession } from "@/data/http/session";
import {
  checkReadiness,
  prepTaskDefs,
  runPreparation,
  type PrepProgress,
} from "./offline-prep";
import { resetCatalogReadCache } from "@/data/local/read-cache";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER_BIZ = "22222222-2222-4222-8222-222222222222";

const api = {
  session: { businessId: BIZ },
  products: { list: vi.fn() },
  customers: { list: vi.fn(), ledger: vi.fn() },
  suppliers: { list: vi.fn() },
  sales: { list: vi.fn(async () => []) },
  cash: { today: vi.fn(async () => ({ moves: [] })), expenses: vi.fn(async () => []) },
  inventory: { moves: vi.fn(async () => []) },
  auth: { me: vi.fn(async () => null) },
  stats: { get: vi.fn(async (period: string) => ({ period, ventas: 0, emptyPeriod: true })) },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));

function installCacheStubs(failPaths: string[] = []) {
  const stored = new Map<string, Response>();
  const cacheStorage = {
    open: async () => ({
      put: async (key: string, res: Response) => {
        stored.set(key, res);
      },
      match: async (key: string) => stored.get(key) ?? undefined,
    }),
  };
  vi.stubGlobal("fetch", async (input: string) => {
    if (failPaths.includes(input)) throw new NetworkError("offline");
    return new Response(`<html>${input}</html>`, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  });
  vi.stubGlobal("window", {
    navigator: { serviceWorker: { controller: {} } },
    caches: cacheStorage,
    dispatchEvent: () => true,
  });
  vi.stubGlobal("navigator", {
    onLine: true,
    serviceWorker: { controller: {} },
    storage: {
      estimate: async () => ({ usage: 1048576, quota: 536870912 }),
      persist: async () => true,
    },
  });
  return stored;
}

function mockCatalogsEmpty() {
  api.products.list.mockResolvedValue([]);
  api.customers.list.mockResolvedValue([]);
  api.suppliers.list.mockResolvedValue([]);
}

describe("offline preparation", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    api.session.businessId = BIZ;
    getPwaAuthSession().businessId = BIZ;
    mockCatalogsEmpty();
    installCacheStubs();
  });

  it("starts not_ready and finishes ready with real progress", async () => {
    expect((await checkReadiness(BIZ)).status).toBe("not_ready");
    const seen: PrepProgress[] = [];
    const row = await runPreparation(BIZ, (p) => seen.push({ ...p }));
    expect(row.status).toBe("ready");
    // 11 static docs + 3 catalogs + 4 snapshots + 3 sistema (sw, storage, verify)
    expect(row.tasks).toHaveLength(22);
    expect(row.tasks.every((t) => t.status === "done")).toBe(true);
    expect(seen.length).toBeGreaterThan(21);
    expect(seen[seen.length - 1]?.completed).toBe(22);
    expect((await checkReadiness(BIZ)).status).toBe("ready");
  });

  it("persists readiness across reload and isolates businesses", async () => {
await runPreparation(BIZ);
    expect((await checkReadiness(BIZ)).status).toBe("ready");
    expect((await checkReadiness(OTHER_BIZ)).status).toBe("not_ready");
  });

  it("goes stale when a catalog snapshot disappears", async () => {
    await runPreparation(BIZ);
    await getLocalDb().cacheMeta.delete(`${BIZ}::products`);
    expect((await checkReadiness(BIZ)).status).toBe("stale");
  });

  it("a failed document marks the run failed without blocking data tasks", async () => {
    installCacheStubs(["/ventas"]);
    const row = await runPreparation(BIZ);
    expect(row.status).toBe("failed");
    const doc = row.tasks.find((t) => t.key === "doc:/ventas");
    expect(doc?.status).toBe("failed");
    expect(doc?.error).toBeTruthy();
    const catalog = row.tasks.find((t) => t.key === "catalog:products");
    expect(catalog?.status).toBe("done");
    expect((await checkReadiness(BIZ)).status).toBe("failed");
  });

  it("retry after failure can complete", async () => {
    installCacheStubs(["/ventas"]);
    await runPreparation(BIZ);
    installCacheStubs();
    const row = await runPreparation(BIZ);
    expect(row.status).toBe("ready");
  });

  it("concurrent callers share a single run", async () => {
    const [first, second] = await Promise.all([runPreparation(BIZ), runPreparation(BIZ)]);
    expect(second).toBe(first);
    expect(first.status).toBe("ready");
  });

  it("creates no outbox operations and no business rows", async () => {
    await runPreparation(BIZ);
    expect(await getLocalDb().outbox.count()).toBe(0);
    expect(await getLocalDb().sales.count()).toBe(0);
    expect(await getLocalDb().customers.count()).toBe(0);
    expect(await getLocalDb().customerPayments.count()).toBe(0);
  });

  it("empty catalogs count as cached and preserve pending rows (D2)", async () => {
    const now = Date.now();
    const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await getLocalDb().customers.put({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      businessId: BIZ,
      code: null,
      name: "Local",
      phone: null,
      debt: 0,
      archivedAt: null,
      requestId,
      createdAt: now,
      updatedAt: now,
    });
    const { getOutboxStore } = await import("@/data/local/outbox");
    await getOutboxStore().enqueue({
      operationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      businessId: BIZ,
      entity: "customer",
      operation: "create",
      requestId,
      payload: { name: "Local" },
    });
    const row = await runPreparation(BIZ);
    expect(row.status).toBe("ready");
    const rows = await getLocalDb().customers.where("businessId").equals(BIZ).toArray();
    expect(rows.map((r) => r.id)).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("generates dynamic documents only for existing Dexie entities", async () => {
    const { dynamicDocumentTasks } = await import("./offline-prep");
    expect(await dynamicDocumentTasks(BIZ)).toEqual([]);
    const now = Date.now();
    await getLocalDb().customers.put({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      businessId: BIZ, code: null, name: "Rosa", phone: null, debt: 0,
      archivedAt: null, createdAt: now, updatedAt: now,
    });
    await getLocalDb().products.put({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      businessId: BIZ, name: "Gomitas", category: "General", price: 500,
      avgCost: 100, stock: 5, lowStockAt: 5, archivedAt: null,
      createdAt: now, updatedAt: now, images: [],
    });
    const tasks = await dynamicDocumentTasks(BIZ);
    const keys = tasks.map((t) => t.key);
    expect(keys).toContain("doc:/clientes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(keys).toContain("doc:/clientes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/abono");
    expect(keys).toContain("doc:/inventario/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(keys).toContain("doc:/inventario/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/surtir");
    expect(keys.some((k) => k.includes("22222222"))).toBe(false);
  });

  it("fails document tasks clearly when the SW does not control the page", async () => {
    vi.stubGlobal("window", {
      navigator: {},
      caches: { open: async () => ({ put: async () => {} }) },
      dispatchEvent: () => true,
    });
    const row = await runPreparation(BIZ);
    expect(row.status).toBe("failed");
    const sw = row.tasks.find((t) => t.key === "sys:sw");
    expect(sw?.status).toBe("failed");
    expect(sw?.error).toContain("Service Worker");
    expect(row.tasks.find((t) => t.key === "catalog:products")?.status).toBe("done");
  });

  it("prefetches primary thumbs best-effort and reports the count", async () => {
    const now = Date.now();
    const remote = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Gomitas",
      category: "General",
      price: 500,
      avgCost: 100,
      stock: 5,
      lowStockAt: 5,
      archivedAt: null,
      createdAt: now,
      images: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          publicId: "dulcecalle/biz/products/prod/req",
          secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/x.jpg",
          version: 1,
          width: 100,
          height: 100,
          format: "jpg",
          bytes: 500,
          position: 0,
          isPrimary: true,
          altText: null,
          createdAt: now,
        },
      ],
    };
    api.products.list.mockResolvedValue([remote]);
    const row = await runPreparation(BIZ);
    const thumbs = row.tasks.find((t) => t.key === "media:thumbs");
    expect(thumbs?.status).toBe("done");
    expect(thumbs?.detail).toBe("1/1 miniaturas");
  });

  it("task list covers documents, catalogs and summaries", () => {
    const defs = prepTaskDefs();
    expect(defs).toHaveLength(18);
    expect(defs.filter((d) => d.group === "app")).toHaveLength(11);
    expect(defs.filter((d) => d.group === "catalogos")).toHaveLength(3);
    expect(defs.filter((d) => d.group === "resumen")).toHaveLength(4);
    expect(defs.map((d) => d.key)).toContain("catalog:products");
    expect(defs.map((d) => d.key)).toContain("snapshot:dashboard");
  });

  it("offline mid-run fails honestly instead of claiming ready", async () => {
    installCacheStubs(["/", "/ventas"]);
    api.products.list.mockRejectedValue(new NetworkError("offline"));
    const row = await runPreparation(BIZ);
    expect(row.status).toBe("failed");
    expect(row.tasks.some((t) => t.status === "failed")).toBe(true);
  });
});
