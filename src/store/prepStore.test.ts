import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLocalDbForTests } from "@/data/local/db";
import {
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { getPwaAuthSession } from "@/data/http/session";
import { prepStore } from "./prepStore";

const BIZ = "11111111-1111-4111-8111-111111111111";

const api = {
  session: { businessId: BIZ },
  products: { list: vi.fn() },
  customers: { list: vi.fn() },
  suppliers: { list: vi.fn() },
};

vi.mock("@/data/pwa/api", () => ({ getPwaApi: () => api }));

function installStubs(online = true) {
  const stored = new Map<string, Response>();
  vi.stubGlobal("fetch", async () => new Response("x", { status: 200 }));
  vi.stubGlobal("window", {
    navigator: { serviceWorker: { controller: {} } },
    caches: {
      open: async () => ({
        put: async (key: string, res: Response) => {
          stored.set(key, res);
        },
        match: async (key: string) => stored.get(key) ?? undefined,
      }),
    },
    dispatchEvent: () => true,
  });
  vi.stubGlobal("navigator", {
    onLine: online,
    storage: {
      estimate: async () => ({ usage: 1048576, quota: 536870912 }),
      persist: async () => true,
    },
  });
}

describe("prepStore evaluate/start", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    prepStore.__reset();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    getPwaAuthSession().businessId = null;
    api.products.list.mockResolvedValue([]);
    api.customers.list.mockResolvedValue([]);
    api.suppliers.list.mockResolvedValue([]);
    installStubs(true);
  });

  it("stays idle without a business session", async () => {
    await prepStore.evaluate();
    expect(prepStore.getSnapshot().phase).toBe("idle");
    expect(prepStore.getSnapshot().modalOpen).toBe(false);
  });

  it("runs to ready and opens the blocking modal", async () => {
    getPwaAuthSession().businessId = BIZ;
    await prepStore.evaluate();
    const snap = prepStore.getSnapshot();
    expect(snap.phase).toBe("ready");
    expect(snap.modalOpen).toBe(true);
    expect(snap.completed).toBe(snap.total);
    // 11 static docs + 3 catalogs + 3 sistema (sw, storage, verify)
    expect(snap.total).toBe(17);
    expect(snap.lastReadyAt).toBeGreaterThan(0);
  });

  it("skips work when already ready and keeps the modal closed", async () => {
    getPwaAuthSession().businessId = BIZ;
    await prepStore.evaluate();
    api.products.list.mockClear();
    await prepStore.evaluate();
    expect(api.products.list).not.toHaveBeenCalled();
    expect(prepStore.getSnapshot().modalOpen).toBe(false);
  });

  it("concurrent starts share one run", async () => {
    getPwaAuthSession().businessId = BIZ;
    let calls = 0;
    api.products.list.mockImplementation(async () => {
      calls += 1;
      return [];
    });
    await Promise.all([prepStore.start(), prepStore.start()]);
    expect(calls).toBe(1);
    expect(prepStore.getSnapshot().phase).toBe("ready");
  });

  it("does nothing while offline", async () => {
    getPwaAuthSession().businessId = BIZ;
    installStubs(false);
    await prepStore.start();
    expect(prepStore.getSnapshot().phase).toBe("idle");
  });
});
