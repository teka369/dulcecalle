import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";

const businessId = "11111111-1111-4111-8111-111111111111";
const otherBusinessId = "22222222-2222-4222-8222-222222222222";
const COMBO_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4333-8333-444444444444";
const REQUEST_ID = "55555555-5555-4555-8555-555555555555";

const api = {
  session: { businessId },
  production: {
    prepare: vi.fn(),
    list: vi.fn(),
  },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

import {
  listPreparationsWithOfflineFallback,
  prepararWithOfflineFallback,
  syncPendingPreparations,
} from "./offline-production";

async function seedProduct(
  id: string,
  business: string,
  over: Record<string, unknown> = {},
) {
  const now = Date.now();
  await getLocalDb().products.put({
    id,
    businessId: business,
    name: id === COMBO_ID ? "Combo enchiladas" : "Enchilada",
    category: "General",
    price: 6000,
    avgCost: 400,
    stock: 10,
    lowStockAt: 5,
    sellable: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    images: [],
    ...over,
  } as never);
}

function remotePrep() {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    sourceId: COMBO_ID,
    targetId: TARGET_ID,
    sourceName: "Combo enchiladas",
    targetName: "Enchilada",
    qty: 10,
    unitCost: 200,
    note: null,
    occurredOn: "2026-09-23",
    createdAt: Date.now(),
  };
}

beforeEach(async () => {
  resetOutboxStoreSingleton();
  resetOutboxSyncEngineSingleton();
  resetLocalStoreSingleton();
  await __resetLocalDbForTests();
  vi.clearAllMocks();
  api.session.businessId = businessId;
});

describe("prepararWithOfflineFallback", () => {
  it("rejects same source and target", async () => {
    await expect(
      prepararWithOfflineFallback(
        { sourceId: COMBO_ID, targetId: COMBO_ID, qty: 10, unitCost: 0 },
        REQUEST_ID,
      ),
    ).rejects.toThrow("distintos");
  });

  it("rejects invalid qty and negative cost", async () => {
    await expect(
      prepararWithOfflineFallback(
        { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 0, unitCost: 0 },
        REQUEST_ID,
      ),
    ).rejects.toThrow();
    await expect(
      prepararWithOfflineFallback(
        { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: -1 },
        REQUEST_ID,
      ),
    ).rejects.toThrow("costo");
  });

  it("rejects unknown or archived products offline", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seedProduct(TARGET_ID, businessId);
    await expect(
      prepararWithOfflineFallback(
        { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: 0 },
        REQUEST_ID,
      ),
    ).rejects.toThrow("sin conexión");
    await seedProduct(COMBO_ID, businessId, { archivedAt: "2026-09-23" });
    await expect(
      prepararWithOfflineFallback(
        { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: 0 },
        REQUEST_ID,
      ),
    ).rejects.toThrow("archivado");
  });

  it("blocks preparation from an empty combo", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seedProduct(COMBO_ID, businessId, { stock: 0 });
    await seedProduct(TARGET_ID, businessId);
    await expect(
      prepararWithOfflineFallback(
        { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: 0 },
        REQUEST_ID,
      ),
    ).rejects.toThrow("material");
  });

  it("online path registers remotely without local writes", async () => {
    api.production.prepare.mockResolvedValue(remotePrep());
    const result = await prepararWithOfflineFallback(
      { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 10, unitCost: 200 },
      REQUEST_ID,
    );
    expect(result.mode).toBe("online");
    expect(api.production.prepare).toHaveBeenCalledWith(
      { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 10, unitCost: 200, note: undefined },
      REQUEST_ID,
    );
    expect(await getLocalDb().preparations.count()).toBe(0);
    expect(await getOutboxStore().listPending(businessId)).toHaveLength(0);
  });

  it("offline path writes preparation + trace moves + outbox atomically", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seedProduct(COMBO_ID, businessId, { stock: 1, avgCost: 105000 });
    await seedProduct(TARGET_ID, businessId, { stock: 10, avgCost: 400 });
    const result = await prepararWithOfflineFallback(
      { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 10, unitCost: 200, note: "tanda" },
      REQUEST_ID,
    );
    expect(result.mode).toBe("offline");

    const rows = await getLocalDb().preparations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId,
      sourceId: COMBO_ID,
      targetId: TARGET_ID,
      qty: 10,
      unitCost: 200,
      note: "tanda",
      requestId: REQUEST_ID,
    });

    const moves = await getLocalDb().stockMoves.toArray();
    expect(moves).toHaveLength(2);
    const target = moves.find((m) => m.productId === TARGET_ID);
    const source = moves.find((m) => m.productId === COMBO_ID);
    expect(target).toMatchObject({ delta: 10, reason: "preparacion", refType: "preparation" });
    expect(source).toMatchObject({ delta: 0, reason: "preparacion", refType: "preparation" });
    expect(target?.refId).toBe(rows[0]?.id);

    // Target stock/avg updated with the SAME weighted formula as the server.
    const updated = await getLocalDb().products.get(TARGET_ID);
    expect(updated?.stock).toBe(20);
    expect(updated?.avgCost).toBe(300);
    // Source lot untouched: yield unknown, the record is the trace.
    expect((await getLocalDb().products.get(COMBO_ID))?.stock).toBe(1);

    const ops = await getOutboxStore().listPending(businessId);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: "preparation", operation: "create", requestId: REQUEST_ID });
  });

  it("refuses a duplicated requestId (no double stock)", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seedProduct(COMBO_ID, businessId);
    await seedProduct(TARGET_ID, businessId);
    await prepararWithOfflineFallback(
      { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: 0 },
      REQUEST_ID,
    );
    await expect(
      prepararWithOfflineFallback(
        { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: 0 },
        REQUEST_ID,
      ),
    ).rejects.toThrow(/requestId already used/);
    expect(await getLocalDb().preparations.count()).toBe(1);
  });

  it("never queues against another business catalog", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seedProduct(COMBO_ID, otherBusinessId);
    await seedProduct(TARGET_ID, otherBusinessId);
    await expect(
      prepararWithOfflineFallback(
        { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: 0 },
        REQUEST_ID,
      ),
    ).rejects.toThrow("sin conexión");
  });
});

describe("syncPendingPreparations", () => {
  it("registers, drops the local row, and never double-syncs", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seedProduct(COMBO_ID, businessId);
    await seedProduct(TARGET_ID, businessId);
    await prepararWithOfflineFallback(
      { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: 100 },
      REQUEST_ID,
    );
    api.production.prepare.mockClear();
    api.production.prepare.mockResolvedValue(remotePrep());
    const first = await syncPendingPreparations(businessId);
    expect(first.synced).toBe(1);
    expect(api.production.prepare).toHaveBeenCalledTimes(1);
    expect(await getLocalDb().preparations.count()).toBe(0);
    const second = await syncPendingPreparations(businessId);
    expect(second.synced).toBe(0);
    expect(api.production.prepare).toHaveBeenCalledTimes(1);
  });
});

describe("listPreparationsWithOfflineFallback", () => {
  it("serves local rows only on transport failure", async () => {
    api.production.list.mockResolvedValue([remotePrep()]);
    const online = await listPreparationsWithOfflineFallback({ targetId: TARGET_ID });
    expect(online.source).toBe("server");

    api.production.list.mockRejectedValue(new NetworkError("offline"));
    await seedProduct(COMBO_ID, businessId);
    await seedProduct(TARGET_ID, businessId);
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await prepararWithOfflineFallback(
      { sourceId: COMBO_ID, targetId: TARGET_ID, qty: 5, unitCost: 0 },
      REQUEST_ID,
    );
    const cached = await listPreparationsWithOfflineFallback({ targetId: TARGET_ID });
    expect(cached.source).toBe("cache");
    expect(cached.rows).toHaveLength(1);

    const err = new ApiError("INTERNAL", "Falla.", 500);
    api.production.list.mockRejectedValue(err);
    await expect(listPreparationsWithOfflineFallback()).rejects.toBe(err);
  });
});
