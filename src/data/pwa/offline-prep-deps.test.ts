import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { mapProduct } from "@/data/http/mappers";

/**
 * Offline preparation replay order: (a) pending preparation payloads are
 * remapped localId → serverId when the offline-created source syncs;
 * (b) a preparation waits for a pending surtir on the same source.
 */
const businessId = "11111111-1111-4111-8111-111111111111";
const SOURCE = "33333333-3333-4333-8333-333333333333";
const TARGET_ID = "44444444-4444-4333-8333-444444444444";
const SERVER_SOURCE = "99999999-9999-4999-8999-999999999999";

const api = {
  session: { businessId },
  products: { create: vi.fn(), get: vi.fn(), patch: vi.fn(), archive: vi.fn() },
  production: { prepare: vi.fn(), list: vi.fn() },
  inventory: { surtir: vi.fn(), shrink: vi.fn() },
};
vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

import { createProductWithOfflineFallback, syncPendingProducts } from "./offline-catalog";
import { prepararWithOfflineFallback, syncPendingPreparations } from "./offline-production";
import { syncAllPending } from "./sync-coordinator";

async function seed(id: string, over: Record<string, unknown> = {}) {
  const now = Date.now();
  await getLocalDb().products.put({
    id, businessId, name: "Enchilada", category: "General", price: 6000, avgCost: 400,
    stock: 10, lowStockAt: 5, sellable: true, archivedAt: null, createdAt: now, updatedAt: now, images: [],
    ...over,
  } as never);
}

const remoteSource = () =>
  mapProduct({
    id: SERVER_SOURCE, name: "Combo enchiladas", category: "General", price: 0, avgCost: 105000,
    stock: 1, lowStockAt: 5, sellable: false, archivedAt: null, createdAt: new Date().toISOString(), images: [],
  });

const remotePrep = (sourceId: string) => ({
  id: "66666666-6666-4666-8666-666666666666", sourceId, targetId: TARGET_ID,
  sourceName: "Combo enchiladas", targetName: "Enchilada", qty: 10, unitCost: 200,
  note: null, occurredOn: "2026-10-13", createdAt: Date.now(),
});

beforeEach(async () => {
  resetOutboxStoreSingleton();
  resetOutboxSyncEngineSingleton();
  resetLocalStoreSingleton();
  await __resetLocalDbForTests();
  vi.clearAllMocks();
});

describe("offline preparation dependencies", () => {
  it("(a) offline-created source → offline prepare → sync: remapped to server id, sent once, same costs", async () => {
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    const created = await createProductWithOfflineFallback(
      { name: "Combo enchiladas", price: 0, stock: 1, avgCost: 105000, sellable: false },
      crypto.randomUUID(),
    );
    if (created.mode !== "offline") throw new Error("expected offline");
    const localId = created.productId;
    await seed(TARGET_ID, { stock: 10, avgCost: 400 });
    const prepKey = crypto.randomUUID();
    await prepararWithOfflineFallback({ sourceId: localId, targetId: TARGET_ID, qty: 10, unitCost: 200 }, prepKey);
    expect((await getLocalDb().products.get(TARGET_ID))?.avgCost).toBe(300);
    expect((await getLocalDb().products.get(localId))?.avgCost).toBe(103000);

    const pending = await getOutboxStore().listPending(businessId);
    const prepOp = pending.find((o) => o.entity === "preparation");
    const createOp = pending.find((o) => o.entity === "product");
    expect(prepOp?.dependsOn).toContain(createOp?.operationId);

    api.products.create.mockResolvedValue(remoteSource());
    api.products.get.mockResolvedValue(remoteSource());
    api.production.prepare.mockResolvedValue(remotePrep(SERVER_SOURCE));
    await syncPendingProducts(businessId);
    await syncPendingPreparations(businessId);
    await syncPendingPreparations(businessId);
    expect(api.production.prepare).toHaveBeenCalledTimes(2); // 1 offline attempt + 1 sync
    expect(api.production.prepare).toHaveBeenLastCalledWith(
      { sourceId: SERVER_SOURCE, targetId: TARGET_ID, qty: 10, unitCost: 200, note: undefined },
      prepKey,
    );
    expect(await getOutboxStore().listPending(businessId)).toHaveLength(0);
  });

  it("(b) waits for a pending surtir on the same source, then syncs", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seed(SOURCE, { sellable: false, stock: 2, avgCost: 120000 });
    await seed(TARGET_ID);
    const surtirOp = crypto.randomUUID();
    await getOutboxStore().enqueue({
      operationId: surtirOp, businessId, entity: "stockMove", operation: "surtir",
      requestId: crypto.randomUUID(),
      payload: { productId: SOURCE, qty: 1, unitCost: 20000, totalCost: 20000, method: "Efectivo" },
      dependsOn: [], localCreatedAt: Date.now(),
    });
    await prepararWithOfflineFallback({ sourceId: SOURCE, targetId: TARGET_ID, qty: 10, unitCost: 200 }, crypto.randomUUID());
    const prep = (await getOutboxStore().listPending(businessId)).find((o) => o.entity === "preparation");
    expect(prep?.dependsOn).toContain(surtirOp);

    api.production.prepare.mockClear();
    expect((await syncPendingPreparations(businessId)).blocked).toBe(1);
    expect(api.production.prepare).not.toHaveBeenCalled();

    await getLocalDb().outbox.update(surtirOp, { status: "synced" });
    api.production.prepare.mockResolvedValue(remotePrep(SOURCE));
    await syncPendingPreparations(businessId);
    expect(api.production.prepare).toHaveBeenCalledTimes(1);
  });

  it("unrelated pending ops do not block", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seed(SOURCE, { sellable: false, stock: 1, avgCost: 10000 });
    await seed(TARGET_ID);
    await getOutboxStore().enqueue({
      operationId: crypto.randomUUID(), businessId, entity: "stockMove", operation: "surtir",
      requestId: crypto.randomUUID(),
      payload: { productId: "77777777-7777-4777-8777-777777777777", qty: 1, unitCost: 1, totalCost: 1, method: "Efectivo" },
      dependsOn: [], localCreatedAt: Date.now(),
    });
    await prepararWithOfflineFallback({ sourceId: SOURCE, targetId: TARGET_ID, qty: 1, unitCost: 0 }, crypto.randomUUID());
    const prep = (await getOutboxStore().listPending(businessId)).find((o) => o.entity === "preparation");
    expect(prep?.dependsOn).toEqual([]);
  });

  it("(b) syncAllPending: surtir first, then the blocked preparation in the extra pass", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    await seed(SOURCE, { sellable: false, stock: 2, avgCost: 120000 });
    await seed(TARGET_ID);
    const order: string[] = [];
    await getOutboxStore().enqueue({
      operationId: crypto.randomUUID(), businessId, entity: "stockMove", operation: "surtir",
      requestId: crypto.randomUUID(),
      payload: { productId: SOURCE, qty: 1, unitCost: 20000, totalCost: 20000, method: "Efectivo" },
      dependsOn: [], localCreatedAt: Date.now(),
    });
    await prepararWithOfflineFallback({ sourceId: SOURCE, targetId: TARGET_ID, qty: 10, unitCost: 200 }, crypto.randomUUID());
    api.production.prepare.mockReset();
    api.inventory.surtir.mockImplementation(async () => {
      order.push("surtir");
      return { id: "88888888-8888-4888-8888-888888888888" };
    });
    api.production.prepare.mockImplementation(async () => {
      order.push("prepare");
      return remotePrep(SOURCE);
    });
    const result = await syncAllPending(businessId);
    expect(order).toEqual(["surtir", "prepare"]);
    expect(result.preparations.blocked).toBe(0);
    expect(await getOutboxStore().listPending(businessId)).toHaveLength(0);
  });
});
