import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __reopenLocalDbForTests, __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { newEntityId } from "@/data/local/ids";
import { createSaleWithOfflineFallback, syncPendingSales } from "./offline-sales";
import {
  applyReturnStockOnce,
  createReturnWithOfflineFallback,
  syncPendingReturns,
} from "./offline-returns";
import { syncAllPending } from "./sync-coordinator";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "33333333-3333-4333-8333-333333333333";
const OTHER_PRODUCT = "44444444-4444-4444-8444-444444444444";

const api = {
  session: { businessId: BIZ },
  sales: {
    create: vi.fn(),
    createReturn: vi.fn(),
    get: vi.fn(),
    returns: vi.fn(),
  },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

function product(id: string, businessId: string, stock: number) {
  const now = Date.now();
  return {
    id,
    businessId,
    name: "Gomitas",
    category: "General",
    price: 1000,
    avgCost: 400,
    stock,
    lowStockAt: 1,
    sellable: true,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    images: [],
  };
}

async function seedSale(stock = 10) {
  const saleId = newEntityId();
  const lineId = newEntityId();
  const now = Date.now();
  await getLocalDb().products.put(product(PRODUCT, BIZ, stock));
  await getLocalDb().products.put(product(OTHER_PRODUCT, OTHER, stock));
  await getLocalDb().sales.put({
    id: saleId,
    businessId: BIZ,
    customerId: null,
    paymentKind: "paid",
    method: "Efectivo",
    saleTotal: 4000,
    amountReceived: 4000,
    credit: 0,
    requestId: newEntityId(),
    note: null,
    occurredOn: "2026-09-27",
    createdAt: now,
    updatedAt: now,
  });
  await getLocalDb().saleLines.put({
    id: lineId,
    businessId: BIZ,
    saleId,
    productId: PRODUCT,
    productName: "Gomitas",
    qty: 4,
    unitPrice: 1000,
    unitCost: 400,
    lineTotal: 4000,
    createdAt: now,
  });
  return { saleId, lineId };
}

function accepted(saleId: string, lineId: string, qty: number) {
  return {
    id: newEntityId(),
    saleId,
    refundAmount: qty * 1000,
    debtReduced: 0,
    method: "Efectivo",
    note: null,
    occurredOn: "2026-09-27",
    createdAt: Date.now(),
    lines: [
      {
        id: newEntityId(),
        saleLineId: lineId,
        productId: PRODUCT,
        qty,
        unitPrice: 1000,
        unitCost: 400,
      },
    ],
  };
}

describe("offline returns", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = BIZ;
    api.sales.get.mockRejectedValue(new NetworkError("offline"));
    api.sales.returns.mockRejectedValue(new NetworkError("offline"));
  });

  it("keeps a client line id and a different remote sale id", async () => {
    await getLocalDb().products.put(product(PRODUCT, BIZ, 10));
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    const created = await createSaleWithOfflineFallback(
      {
        lines: [{ productId: PRODUCT, qty: 2, unitPrice: 1000 }],
        paymentKind: "paid",
        amountReceived: 2000,
        method: "Efectivo",
      },
      newEntityId(),
    );
    expect(created.mode).toBe("offline");
    if (created.mode !== "offline") return;
    const line = await getLocalDb().saleLines.where("saleId").equals(created.saleId).first();
    const op = await getOutboxStore().get(BIZ, created.saleId);
    const payload = op?.payload as { lines: Array<{ id: string }> };
    expect(payload.lines[0].id).toBe(line?.id);
    expect(created.saleId).not.toBe(line?.id);

    const remoteSaleId = newEntityId();
    api.sales.create.mockResolvedValueOnce({ id: remoteSaleId });
    await syncPendingSales(BIZ);
    const synced = await getOutboxStore().get(BIZ, created.saleId);
    expect(synced?.remoteId).toBe(remoteSaleId);
    expect(synced?.remoteId).not.toBe(created.saleId);
    expect(line?.id).not.toBe(remoteSaleId);
  });

  it("does not change stock while the return is pending", async () => {
    const { saleId, lineId } = await seedSale(10);
    api.sales.createReturn.mockRejectedValue(new NetworkError("offline"));
    const queued = await createReturnWithOfflineFallback(
      saleId,
      [{ saleLineId: lineId, qty: 2 }],
      newEntityId(),
    );
    expect(queued.mode).toBe("offline");
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(10);
    expect((await getLocalDb().products.get(PRODUCT))?.avgCost).toBe(400);
    expect(
      (await getLocalDb().stockMoves.toArray()).filter((move) => move.reason === "devolucion"),
    ).toHaveLength(0);
    const op = await getOutboxStore().getByRequestId(
      BIZ,
      (await getLocalDb().outbox.toArray())[0].requestId,
    );
    expect(op?.entity).toBe("saleReturn");
    expect(op?.status).toBe("pending");
  });

  it("adds stock once on 201, including a lost response retry", async () => {
    const { saleId, lineId } = await seedSale(10);
    const requestId = newEntityId();
    api.sales.createReturn.mockRejectedValueOnce(new NetworkError("offline"));
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 2 }], requestId);
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(10);

    api.sales.createReturn.mockResolvedValue(accepted(saleId, lineId, 2));
    await syncPendingReturns(BIZ);
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(12);
    expect((await getLocalDb().products.get(PRODUCT))?.avgCost).toBe(400);
    const moves = (await getLocalDb().stockMoves.toArray()).filter(
      (move) => move.reason === "devolucion",
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]?.requestId).toBe(requestId);

    await applyReturnStockOnce(BIZ, requestId, [
      { productId: PRODUCT, qty: 2, unitCost: 400 },
    ]);
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(12);

    await syncPendingReturns(BIZ);
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(12);
    expect(api.sales.createReturn).toHaveBeenCalledTimes(2);
  });

  it("does not add stock on reject, 401, network, 5xx or a closed day", async () => {
    const cases = [
      new ApiError("RETURN_EXCEEDS", "de más", 409),
      new ApiError("CLOSED_DAY", "cerrado", 409),
      new ApiError("UNAUTHORIZED", "entra", 401),
      new NetworkError("offline"),
      new ApiError("INTERNAL", "mal", 500),
    ];
    for (const error of cases) {
      resetOutboxStoreSingleton();
      resetOutboxSyncEngineSingleton();
      await __resetLocalDbForTests();
      const { saleId, lineId } = await seedSale(10);
      api.sales.createReturn.mockReset();
      api.sales.createReturn.mockRejectedValueOnce(new NetworkError("offline"));
      await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 2 }], newEntityId());
      api.sales.createReturn.mockRejectedValueOnce(error);
      await syncPendingReturns(BIZ);
      expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(10);
      expect(
      (await getLocalDb().stockMoves.toArray()).filter((move) => move.reason === "devolucion"),
    ).toHaveLength(0);
      if (error instanceof ApiError && error.status === 401) {
        const pending = await getOutboxStore().listPending(BIZ);
        expect(pending.some((row) => row.entity === "saleReturn")).toBe(true);
      }
    }
  });

  it("sells against the unconfirmed stock and does not roll the sale back", async () => {
    const { saleId, lineId } = await seedSale(10);
    api.sales.createReturn.mockRejectedValue(new NetworkError("offline"));
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 2 }], newEntityId());
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(10);

    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    await createSaleWithOfflineFallback(
      {
        lines: [{ productId: PRODUCT, qty: 3, unitPrice: 1000 }],
        paymentKind: "paid",
        amountReceived: 3000,
        method: "Efectivo",
      },
      newEntityId(),
    );
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(7);

    api.sales.createReturn.mockRejectedValueOnce(new ApiError("RETURN_EXCEEDS", "no", 409));
    await syncPendingReturns(BIZ);
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(7);
    expect((await getLocalDb().products.get(OTHER_PRODUCT))?.stock).toBe(10);
  });

  it("waits for the offline sale, then posts the remote sale id and the original line id", async () => {
    await getLocalDb().products.put(product(PRODUCT, BIZ, 10));
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId: PRODUCT, qty: 2, unitPrice: 1000 }],
        paymentKind: "paid",
        amountReceived: 2000,
        method: "Efectivo",
      },
      newEntityId(),
    );
    if (sale.mode !== "offline") throw new Error("expected offline sale");
    const line = await getLocalDb().saleLines.where("saleId").equals(sale.saleId).first();
    const remoteSaleId = newEntityId();
    api.sales.createReturn.mockResolvedValue(accepted(remoteSaleId, line!.id, 2));
    await createReturnWithOfflineFallback(
      sale.saleId,
      [{ saleLineId: line!.id, qty: 2 }],
      newEntityId(),
    );
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(8);
    const ret = (await getLocalDb().outbox.toArray()).find((row) => row.entity === "saleReturn");
    expect(ret?.dependsOn).toEqual([sale.saleId]);
    expect((ret?.payload as { lines: Array<{ saleLineId: string }> }).lines[0].saleLineId).toBe(line!.id);

    api.sales.create.mockResolvedValue({ id: remoteSaleId });
    const cycle = await syncAllPending(BIZ);
    expect(cycle.sales.synced).toBe(1);
    expect(cycle.returns.synced).toBe(1);
    expect(api.sales.createReturn).toHaveBeenCalledWith(
      remoteSaleId,
      { lines: [{ saleLineId: line!.id, qty: 2 }] },
      ret?.requestId,
    );
    const createAt = api.sales.create.mock.invocationCallOrder.at(-1) ?? 0;
    const returnAt = api.sales.createReturn.mock.invocationCallOrder[0] ?? 0;
    expect(createAt).toBeLessThan(returnAt);
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(10);
  });

  it("keeps a pending return across reload and a stale product GET", async () => {
    const { saleId, lineId } = await seedSale(10);
    const requestId = newEntityId();
    api.sales.createReturn.mockRejectedValue(new NetworkError("offline"));
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 2 }], requestId);
    __reopenLocalDbForTests();
    resetOutboxStoreSingleton();
    const op = await getOutboxStore().getByRequestId(BIZ, requestId);
    expect(op?.status).toBe("pending");
    expect(op?.dependsOn).toEqual([]);
    expect((op?.payload as { lines: Array<{ qty: number }> }).lines[0].qty).toBe(2);

    const { getLocalStore } = await import("../local/store");
    const current = product(PRODUCT, BIZ, 10);
    await getLocalStore().products.replaceAll(BIZ, [current]);
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(10);
    expect((await getOutboxStore().getByRequestId(BIZ, requestId))?.status).toBe("pending");
  });

  it("accepts one return and ignores the one the server rejects", async () => {
    const { saleId, lineId } = await seedSale(10);
    const line = await getLocalDb().saleLines.get(lineId);
    await getLocalDb().saleLines.put({ ...line!, qty: 6, lineTotal: 6000 });
    api.sales.createReturn.mockRejectedValue(new NetworkError("offline"));
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 2 }], newEntityId());
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 3 }], newEntityId());
    api.sales.createReturn.mockReset();
    api.sales.createReturn
      .mockResolvedValueOnce(accepted(saleId, lineId, 2))
      .mockRejectedValueOnce(new ApiError("RETURN_EXCEEDS", "no", 409));
    await syncPendingReturns(BIZ);
    expect((await getLocalDb().products.get(PRODUCT))?.stock).toBe(12);
  });
});
