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
import { deriveRequestId } from "@/domain/requestId";
import { syncPendingOperations } from "./offline-operations";
import { syncPendingSuppliers } from "./offline-catalog";
import { inventoryStore } from "@/store/inventoryStore";

const businessId = "11111111-1111-4111-8111-111111111111";
const productId = "33333333-3333-4333-8333-333333333333";
const serverSupplierId = "55555555-5555-4555-8555-555555555555";
const surtirRequestId = "66666666-6666-4666-8666-666666666666";

const api = {
  session: { businessId },
  suppliers: { create: vi.fn(), get: vi.fn(), patch: vi.fn() },
  inventory: { surtir: vi.fn(), shrink: vi.fn() },
};

vi.mock("@/data/pwa/api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

async function seedProduct() {
  const now = Date.now();
  await getLocalDb().products.put({
    id: productId, businessId, name: "Gomitas", category: "General", price: 500,
    avgCost: 100, stock: 10, lowStockAt: 5, sellable: true, archivedAt: null,
    createdAt: now, updatedAt: now, images: [],
  } as never);
}

function surtirInput(extra: Record<string, unknown> = {}) {
  return {
    productId, qtyRaw: "2", unitCostRaw: "100", totalCostRaw: "200",
    method: "Efectivo" as const, requestId: surtirRequestId, ...extra,
  };
}

beforeEach(async () => {
  resetOutboxSyncEngineSingleton();
  resetOutboxStoreSingleton();
  resetLocalStoreSingleton();
  await __resetLocalDbForTests();
  for (const fn of [api.suppliers.create, api.suppliers.get, api.suppliers.patch, api.inventory.surtir]) {
    fn.mockReset();
  }
  vi.spyOn(inventoryStore, "refreshAll").mockResolvedValue(undefined as never);
  await seedProduct();
});

describe("offline surtir with an inline new supplier", () => {
  it("queues supplier:create and the surtir (dependent on it)", async () => {
    api.suppliers.create.mockRejectedValue(new NetworkError("offline"));
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await inventoryStore.surtir(surtirInput({ supplierNameCreate: "Don Pepe" }));

    const ops = await getOutboxStore().listPending(businessId);
    const supplierOp = ops.find((op) => op.entity === "supplier" && op.operation === "create");
    const surtirOp = ops.find((op) => op.entity === "stockMove" && op.operation === "surtir");
    expect(supplierOp).toBeDefined();
    expect(surtirOp).toBeDefined();
    expect(supplierOp!.requestId).toBe(await deriveRequestId(surtirRequestId, "surtir:supplier"));
    expect(surtirOp!.requestId).toBe(surtirRequestId);
    expect(surtirOp!.dependsOn).toContain(supplierOp!.operationId);
    expect((await getLocalDb().products.get(productId))?.stock).toBe(12);
  });

  it("syncs the surtir after the supplier with the remapped server id", async () => {
    api.suppliers.create.mockRejectedValue(new NetworkError("offline"));
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await inventoryStore.surtir(surtirInput({ supplierNameCreate: "Don Pepe" }));
    const localSupplierId = (await getLocalDb().suppliers.toArray())[0].id;

    // Surtir cannot go first: its dependency is still pending.
    api.inventory.surtir.mockReset();
    api.inventory.surtir.mockResolvedValue({ id: "77777777-7777-4777-8777-777777777777" });
    await syncPendingOperations(businessId);
    expect(api.inventory.surtir).not.toHaveBeenCalled();

    const order: string[] = [];
    api.suppliers.create.mockReset();
    api.suppliers.create.mockImplementation(async () => {
      order.push("supplier");
      return { id: serverSupplierId };
    });
    api.suppliers.get.mockResolvedValue({
      id: serverSupplierId, name: "Don Pepe", phone: null, notes: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    api.inventory.surtir.mockImplementation(async () => {
      order.push("surtir");
      return { id: "77777777-7777-4777-8777-777777777777" };
    });
    await syncPendingSuppliers(businessId);
    // reconcileSupplier rewrote the pending payload + local stock move.
    const pending = (await getOutboxStore().listPending(businessId)).find((op) => op.entity === "stockMove");
    expect((pending!.payload as { supplierId: string }).supplierId).toBe(serverSupplierId);
    const move = (await getLocalDb().stockMoves.toArray())[0];
    expect(move.supplierId).toBe(serverSupplierId);
    expect(await getLocalDb().suppliers.get(localSupplierId)).toBeUndefined();

    await syncPendingOperations(businessId);
    expect(order).toEqual(["supplier", "surtir"]);
    expect(api.inventory.surtir).toHaveBeenCalledWith(
      productId,
      expect.objectContaining({ supplierId: serverSupplierId }),
      surtirRequestId,
    );
  });

  it("remaps from the dependency remoteId even if reconcile could not run", async () => {
    api.suppliers.create.mockRejectedValue(new NetworkError("offline"));
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await inventoryStore.surtir(surtirInput({ supplierNameCreate: "Don Pepe" }));
    api.suppliers.create.mockReset();
    api.suppliers.create.mockResolvedValue({ id: serverSupplierId });
    api.suppliers.get.mockRejectedValue(new NetworkError("offline"));
    await syncPendingSuppliers(businessId);
    api.inventory.surtir.mockReset();
    api.inventory.surtir.mockResolvedValue({ id: "77777777-7777-4777-8777-777777777777" });
    await syncPendingOperations(businessId);
    expect(api.inventory.surtir).toHaveBeenCalledWith(
      productId,
      expect.objectContaining({ supplierId: serverSupplierId }),
      surtirRequestId,
    );
  });

  it("a retry with the same surtir requestId does not duplicate the supplier", async () => {
    api.suppliers.create.mockRejectedValue(new NetworkError("offline"));
    // First attempt: supplier saved, then surtir fails for a non-network reason.
    api.inventory.surtir.mockRejectedValueOnce(new Error("boom"));
    await expect(
      inventoryStore.surtir(surtirInput({ supplierNameCreate: "Don Pepe" })),
    ).rejects.toThrow();
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await inventoryStore.surtir(surtirInput({ supplierNameCreate: "Don Pepe" }));
    await inventoryStore.surtir(surtirInput({ supplierNameCreate: "Don Pepe" })).catch(() => {});

    expect(await getLocalDb().suppliers.count()).toBe(1);
    const ops = await getOutboxStore().listPending(businessId);
    expect(ops.filter((op) => op.entity === "supplier")).toHaveLength(1);
    const surtirOps = ops.filter((op) => op.entity === "stockMove");
    expect(surtirOps.length).toBeGreaterThanOrEqual(1);
    expect(new Set(surtirOps.map((op) => op.requestId))).toEqual(new Set([surtirRequestId]));
  });

  it("an already-synced supplier is unchanged (no supplier op, plain id)", async () => {
    const now = Date.now();
    await getLocalDb().suppliers.put({
      id: serverSupplierId, businessId, name: "Sincronizado", phone: null, notes: null,
      createdAt: now, updatedAt: now,
    } as never);
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await inventoryStore.surtir(surtirInput({ supplierId: serverSupplierId }));
    const ops = await getOutboxStore().listPending(businessId);
    expect(ops.filter((op) => op.entity === "supplier")).toHaveLength(0);
    const surtirOp = ops.find((op) => op.entity === "stockMove")!;
    expect((surtirOp.payload as { supplierId: string }).supplierId).toBe(serverSupplierId);
    expect(surtirOp.dependsOn.length).toBe(0);
    expect(api.suppliers.create).not.toHaveBeenCalled();
  });
});
