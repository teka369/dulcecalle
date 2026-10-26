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
import { canPrepareFrom } from "@/components/inventory/inventory";

/**
 * TICKET-A (combo kind) — offline/outbox behaviour:
 * AC1 local create forces sellable=false, AC4 offline preparation syncs once
 * with online costs (incl. localId → serverId remap and dependsOn on pending
 * stock ops), J-A3 local guard, mapper back-compat.
 */
const businessId = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "44444444-4444-4333-8333-444444444444";
const SERVER_COMBO = "99999999-9999-4999-8999-999999999999";

const api = {
  session: { businessId },
  products: { create: vi.fn(), get: vi.fn(), patch: vi.fn(), archive: vi.fn() },
  inventory: { surtir: vi.fn() },
  production: { prepare: vi.fn(), list: vi.fn() },
};
vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

import {
  createProductWithOfflineFallback,
  patchProductWithOfflineFallback,
  syncPendingProducts,
} from "./offline-catalog";
import { surtirWithOfflineFallback } from "./offline-operations";
import {
  ONLY_COMBO_SOURCE,
  prepararWithOfflineFallback,
  syncPendingPreparations,
} from "./offline-production";

async function seed(id: string, over: Record<string, unknown> = {}) {
  const now = Date.now();
  await getLocalDb().products.put({
    id,
    businessId,
    name: "Enchilada",
    category: "General",
    price: 6000,
    avgCost: 400,
    stock: 10,
    lowStockAt: 5,
    sellable: true,
    kind: "standard",
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    images: [],
    ...over,
  } as never);
}

const remoteProduct = (over: Record<string, unknown> = {}) =>
  mapProduct({
    id: SERVER_COMBO,
    name: "Combo enchiladas",
    category: "General",
    price: 0,
    avgCost: 105000,
    stock: 1,
    lowStockAt: 5,
    sellable: false,
    kind: "combo",
    archivedAt: null,
    createdAt: new Date().toISOString(),
    images: [],
    ...over,
  });

beforeEach(async () => {
  resetOutboxStoreSingleton();
  resetOutboxSyncEngineSingleton();
  resetLocalStoreSingleton();
  await __resetLocalDbForTests();
  vi.clearAllMocks();
});

describe("TICKET-A mapper + helpers", () => {
  it("maps kind and leaves it undefined for older servers", () => {
    expect(remoteProduct().kind).toBe("combo");
    expect(remoteProduct({ kind: undefined }).kind).toBeUndefined();
    expect(remoteProduct({ kind: "kit" }).kind).toBeUndefined();
  });

  it("canPrepareFrom: only combo; unknown kind falls back to the insumo rule", () => {
    expect(canPrepareFrom({ kind: "combo", sellable: false })).toBe(true);
    expect(canPrepareFrom({ kind: "standard", sellable: false })).toBe(false);
    expect(canPrepareFrom({ sellable: false })).toBe(true);
    expect(canPrepareFrom({ sellable: true })).toBe(false);
  });
});

describe("TICKET-A offline create/patch", () => {
  it("AC1: offline combo is stored non-sellable with lot value; payload carries kind", async () => {
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    const r = await createProductWithOfflineFallback(
      { name: "Combo", price: 0, stock: 2, avgCost: 50000, kind: "combo", sellable: true },
      crypto.randomUUID(),
    );
    if (r.mode !== "offline") throw new Error("expected offline");
    const row = await getLocalDb().products.get(r.productId);
    expect(row).toMatchObject({ kind: "combo", sellable: false, avgCost: 100000 });
    const [op] = await getOutboxStore().listPending(businessId);
    expect(op.payload).toMatchObject({ kind: "combo", sellable: false });
  });

  it("standard create payload stays without kind (byte-identical to pre-TICKET-A)", async () => {
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    await createProductWithOfflineFallback({ name: "Gomitas", price: 1000 }, crypto.randomUUID());
    const [op] = await getOutboxStore().listPending(businessId);
    expect(op.payload).not.toHaveProperty("kind");
  });

  it("AC3: local guard rejects changing kind with stock", async () => {
    await seed(TARGET_ID, { stock: 3 });
    await expect(
      patchProductWithOfflineFallback(TARGET_ID, { kind: "combo" }, crypto.randomUUID()),
    ).rejects.toThrow("No se puede cambiar el tipo");
    expect(api.products.patch).not.toHaveBeenCalled();
  });

  it("AC1: patch sellable=true on a combo is rejected locally", async () => {
    await seed(TARGET_ID, { stock: 0 });
    await expect(
      patchProductWithOfflineFallback(TARGET_ID, { kind: "combo", sellable: true }, crypto.randomUUID()),
    ).rejects.toThrow("Un combo no se puede vender");
  });
});

describe("TICKET-A offline preparation (AC4)", () => {
  it("J-A3: a known standard source is rejected offline; unknown kind is left to the server", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    const SRC = "33333333-3333-4333-8333-333333333333";
    await seed(SRC, { kind: "standard", sellable: false, stock: 1, avgCost: 5000 });
    await seed(TARGET_ID);
    await expect(
      prepararWithOfflineFallback({ sourceId: SRC, targetId: TARGET_ID, qty: 1, unitCost: 0 }, crypto.randomUUID()),
    ).rejects.toThrow(ONLY_COMBO_SOURCE);
    await seed(SRC, { kind: undefined, sellable: false, stock: 1, avgCost: 5000 });
    const ok = await prepararWithOfflineFallback(
      { sourceId: SRC, targetId: TARGET_ID, qty: 1, unitCost: 0 },
      crypto.randomUUID(),
    );
    expect(ok.mode).toBe("offline");
  });

  it("offline combo create → offline prepare → sync: remapped to server id, applied once, same costs", async () => {
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    const created = await createProductWithOfflineFallback(
      { name: "Combo enchiladas", price: 0, stock: 1, avgCost: 105000, kind: "combo" },
      crypto.randomUUID(),
    );
    if (created.mode !== "offline") throw new Error("expected offline");
    const localId = created.productId;
    await seed(TARGET_ID, { stock: 10, avgCost: 400 });
    const prepKey = crypto.randomUUID();
    await prepararWithOfflineFallback({ sourceId: localId, targetId: TARGET_ID, qty: 10, unitCost: 200 }, prepKey);

    // Local numbers = server numbers (see backend combo-kind.e2e AC2+AC4).
    expect((await getLocalDb().products.get(TARGET_ID))?.avgCost).toBe(300);
    expect((await getLocalDb().products.get(localId))?.avgCost).toBe(103000);

    const prepOp = (await getOutboxStore().listPending(businessId)).find((o) => o.entity === "preparation");
    const createOp = (await getOutboxStore().listPending(businessId)).find((o) => o.entity === "product");
    expect(prepOp?.dependsOn).toContain(createOp?.operationId);

    api.products.create.mockResolvedValue(remoteProduct());
    api.products.get.mockResolvedValue(remoteProduct({ avgCost: 105000 }));
    api.production.prepare.mockResolvedValue({
      id: "66666666-6666-4666-8666-666666666666",
      sourceId: SERVER_COMBO,
      targetId: TARGET_ID,
      sourceName: "Combo enchiladas",
      targetName: "Enchilada",
      qty: 10,
      unitCost: 200,
      note: null,
      occurredOn: "2026-10-13",
      createdAt: Date.now(),
    });
    await syncPendingProducts(businessId);
    await syncPendingPreparations(businessId);
    await syncPendingPreparations(businessId);
    expect(api.production.prepare).toHaveBeenCalledTimes(2); // 1 offline attempt + 1 sync
    expect(api.production.prepare).toHaveBeenLastCalledWith(
      { sourceId: SERVER_COMBO, targetId: TARGET_ID, qty: 10, unitCost: 200, note: undefined },
      prepKey,
    );
    expect(await getOutboxStore().listPending(businessId)).toHaveLength(0);
  });

  it("queues behind a pending surtir on the combo so the server sees the same lot value", async () => {
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    const COMBO = "33333333-3333-4333-8333-333333333333";
    await seed(COMBO, { kind: "combo", sellable: false, stock: 2, avgCost: 120000 });
    await seed(TARGET_ID);
    const surtirOp = crypto.randomUUID();
    await getOutboxStore().enqueue({
      operationId: surtirOp,
      businessId,
      entity: "stockMove",
      operation: "surtir",
      requestId: crypto.randomUUID(),
      payload: { productId: COMBO, qty: 1, unitCost: 20000, totalCost: 20000, method: "Efectivo" },
      dependsOn: [],
      localCreatedAt: Date.now(),
    });
    await prepararWithOfflineFallback(
      { sourceId: COMBO, targetId: TARGET_ID, qty: 10, unitCost: 200 },
      crypto.randomUUID(),
    );
    const prep = (await getOutboxStore().listPending(businessId)).find((o) => o.entity === "preparation");
    expect(prep?.dependsOn).toContain(surtirOp);
    // Surtir still pending → the preparation does not jump the queue.
    api.production.prepare.mockClear();
    const flush = await syncPendingPreparations(businessId);
    expect(api.production.prepare).not.toHaveBeenCalled();
    expect(flush.blocked).toBe(1);
  });

  it("CatalogReadCache preserves kind=combo on pending offline creates and cleanupOutboxLocalEffect reverts combo lot avgCost on rejection", async () => {
    const { getCatalogReadCache } = await import("@/data/local/read-cache");
    const { cleanupOutboxLocalEffect } = await import("@/data/local/outbox-cleanup");
    api.products.create.mockRejectedValue(new NetworkError("offline"));
    const created = await createProductWithOfflineFallback(
      { name: "Combo offline", price: 0, stock: 2, avgCost: 25000, kind: "combo" },
      crypto.randomUUID(),
    );
    if (created.mode !== "offline") throw new Error("expected offline");

    // Online listProducts returns only a server standard product while the offline combo is still pending:
    const listed = await getCatalogReadCache().listProducts(businessId, async () => [
      remoteProduct({ id: TARGET_ID, name: "Enchilada", kind: "standard", sellable: true, stock: 10, avgCost: 400 }),
    ]);
    const mergedCombo = listed.data.find((p) => p.id === created.productId);
    expect(mergedCombo).toMatchObject({ name: "Combo offline", kind: "combo", sellable: false, avgCost: 50000 });

    // Queue an offline preparation from the combo (lot avgCost: 50000 -> 48000), then revert on rejection:
    api.production.prepare.mockRejectedValue(new NetworkError("offline"));
    const prep = await prepararWithOfflineFallback(
      { sourceId: created.productId, targetId: TARGET_ID, qty: 10, unitCost: 200 },
      crypto.randomUUID(),
    );
    if (prep.mode !== "offline") throw new Error("expected offline");
    expect((await getLocalDb().products.get(created.productId))?.avgCost).toBe(48000);

    const prepOp = await getLocalDb().outbox.get(prep.id);
    await cleanupOutboxLocalEffect(getLocalDb(), businessId, prepOp!, "reject");
    expect((await getLocalDb().products.get(created.productId))?.avgCost).toBe(50000);
    expect((await getLocalDb().products.get(TARGET_ID))?.stock).toBe(10);
    expect((await getLocalDb().products.get(TARGET_ID))?.avgCost).toBe(400);
  });
  it("Case A: preparation (t=1, -2000) then surtir (t=2, +20000) on a combo (avgCost=50000) restores 70000 on prep rejection and 50000 on surtir rejection", async () => {
    const { cleanupOutboxLocalEffect } = await import("@/data/local/outbox-cleanup");
    const COMBO = "33333333-3333-4333-8333-333333333333";
    await seed(COMBO, { kind: "combo", sellable: false, stock: 2, avgCost: 50000 });
    await seed(TARGET_ID, { kind: "standard", sellable: true, stock: 10, avgCost: 400 });

    api.production.prepare.mockRejectedValueOnce(new NetworkError("offline"));
    const prep = await prepararWithOfflineFallback(
      { sourceId: COMBO, targetId: TARGET_ID, qty: 10, unitCost: 200 },
      crypto.randomUUID(),
    );
    if (prep.mode !== "offline") throw new Error("expected offline");
    expect((await getLocalDb().products.get(COMBO))?.avgCost).toBe(48000);

    api.inventory.surtir.mockRejectedValueOnce(new NetworkError("offline"));
    const surtir = await surtirWithOfflineFallback(
      { productId: COMBO, qty: 1, unitCost: 20000, totalCost: 20000, method: "Efectivo" },
      crypto.randomUUID(),
    );
    if (surtir.mode !== "offline") throw new Error("expected offline");
    expect((await getLocalDb().products.get(COMBO))?.avgCost).toBe(68000);
    expect((await getLocalDb().products.get(COMBO))?.stock).toBe(3);

    // 1) Reject preparation (t=1) while surtir (t=2) stays pending: combo lot pool is 50000 + 20000 = 70000
    const prepOp = await getLocalDb().outbox.get(prep.id);
    await cleanupOutboxLocalEffect(getLocalDb(), businessId, prepOp!, "reject");
    expect((await getLocalDb().products.get(COMBO))?.avgCost).toBe(70000);
    expect((await getLocalDb().products.get(COMBO))?.stock).toBe(3);

    // 2) Reject surtir (t=2): combo lot pool returns to 50000 (not 70000) and stock returns to 2
    const surtirOp = await getLocalDb().outbox.get(surtir.id);
    await cleanupOutboxLocalEffect(getLocalDb(), businessId, surtirOp!, "reject");
    expect((await getLocalDb().products.get(COMBO))?.avgCost).toBe(50000);
    expect((await getLocalDb().products.get(COMBO))?.stock).toBe(2);
  });

  it("Case B: surtir (t=1, +20000) then preparation (t=2, -2000) on a combo (avgCost=50000) restores 48000 on surtir rejection and 50000 on prep rejection", async () => {
    const { cleanupOutboxLocalEffect } = await import("@/data/local/outbox-cleanup");
    const COMBO = "33333333-3333-4333-8333-333333333333";
    await seed(COMBO, { kind: "combo", sellable: false, stock: 2, avgCost: 50000 });
    await seed(TARGET_ID, { kind: "standard", sellable: true, stock: 10, avgCost: 400 });

    api.inventory.surtir.mockRejectedValueOnce(new NetworkError("offline"));
    const surtir = await surtirWithOfflineFallback(
      { productId: COMBO, qty: 1, unitCost: 20000, totalCost: 20000, method: "Efectivo" },
      crypto.randomUUID(),
    );
    if (surtir.mode !== "offline") throw new Error("expected offline");
    expect((await getLocalDb().products.get(COMBO))?.avgCost).toBe(70000);
    expect((await getLocalDb().products.get(COMBO))?.stock).toBe(3);

    api.production.prepare.mockRejectedValueOnce(new NetworkError("offline"));
    const prep = await prepararWithOfflineFallback(
      { sourceId: COMBO, targetId: TARGET_ID, qty: 10, unitCost: 200 },
      crypto.randomUUID(),
    );
    if (prep.mode !== "offline") throw new Error("expected offline");
    expect((await getLocalDb().products.get(COMBO))?.avgCost).toBe(68000);

    // 1) Reject surtir (t=1) while preparation (t=2) stays pending: combo lot pool is 50000 - 2000 = 48000
    const surtirOp = await getLocalDb().outbox.get(surtir.id);
    await cleanupOutboxLocalEffect(getLocalDb(), businessId, surtirOp!, "reject");
    expect((await getLocalDb().products.get(COMBO))?.avgCost).toBe(48000);
    expect((await getLocalDb().products.get(COMBO))?.stock).toBe(2);

    // 2) Reject preparation (t=2): combo lot pool returns to 50000 (not 52000)
    const prepOp = await getLocalDb().outbox.get(prep.id);
    await cleanupOutboxLocalEffect(getLocalDb(), businessId, prepOp!, "reject");
    expect((await getLocalDb().products.get(COMBO))?.avgCost).toBe(50000);
    expect((await getLocalDb().products.get(COMBO))?.stock).toBe(2);
  });
});
