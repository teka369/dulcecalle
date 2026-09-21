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
import { newEntityId } from "@/data/local/ids";
import {
  getSaleDetailWithOfflineFallback,
  listSalesWithOfflineFallback,
} from "./offline-sales";
import { listLocalStockMoves } from "./offline-operations";

const BIZ = "11111111-1111-4111-8111-111111111111";
const SALE_ID = "33333333-3333-4333-8333-333333333333";

const api = {
  session: { businessId: BIZ },
  sales: { list: vi.fn(), get: vi.fn(), returns: vi.fn(), create: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

async function seedLocalSale(requestId = "44444444-4444-4444-8444-444444444444") {
  const now = Date.now();
  await getLocalDb().sales.put({
    id: SALE_ID,
    businessId: BIZ,
    customerId: null,
    paymentKind: "paid",
    method: "Efectivo",
    saleTotal: 1500,
    amountReceived: 1500,
    credit: 0,
    requestId,
    note: null,
    occurredOn: "2026-09-20",
    createdAt: now,
    updatedAt: now,
  });
  await getLocalDb().saleLines.put({
    id: newEntityId(),
    businessId: BIZ,
    saleId: SALE_ID,
    productId: newEntityId(),
    productName: "Gomitas",
    qty: 3,
    unitPrice: 500,
    unitCost: 100,
    lineTotal: 1500,
    createdAt: now,
  });
  await getOutboxStore().enqueue({
    operationId: SALE_ID,
    businessId: BIZ,
    entity: "sale",
    operation: "create",
    requestId,
    payload: {},
  });
  return requestId;
}

function serverSale() {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    customerId: null,
    paymentKind: "paid",
    method: "Efectivo",
    saleTotal: 2000,
    amountReceived: 2000,
    credit: 0,
    note: null,
    occurredOn: "2026-09-20",
    createdAt: Date.now(),
    lines: [],
  };
}

describe("offline sales readers", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = BIZ;
  });

  it("online list passes server rows through as not pending", async () => {
    api.sales.list.mockResolvedValue([serverSale()]);
    const result = await listSalesWithOfflineFallback();
    expect(result.source).toBe("server");
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]?.pending).toBe(false);
  });

  it("NetworkError serves local rows flagged pending", async () => {
    await seedLocalSale();
    api.sales.list.mockRejectedValue(new NetworkError("offline"));
    const result = await listSalesWithOfflineFallback();
    expect(result.source).toBe("cache");
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0]).toMatchObject({ id: SALE_ID, saleTotal: 1500, pending: true });
    expect(result.sales[0]?.lines).toHaveLength(1);
  });

  it("NetworkError without local rows is empty, not an error", async () => {
    api.sales.list.mockRejectedValue(new NetworkError("offline"));
    const result = await listSalesWithOfflineFallback();
    expect(result.source).toBe("cache");
    expect(result.sales).toEqual([]);
  });

  it("ApiError is rethrown, never masked as empty", async () => {
    const serverError = new ApiError("INTERNAL", "Falla el servidor.", 500);
    api.sales.list.mockRejectedValue(serverError);
    await expect(listSalesWithOfflineFallback()).rejects.toBe(serverError);
  });

  it("detail serves a locally-created sale with its pending flag", async () => {
    await seedLocalSale();
    api.sales.get.mockRejectedValue(new NetworkError("offline"));
    const result = await getSaleDetailWithOfflineFallback(SALE_ID);
    expect(result?.source).toBe("cache");
    expect(result?.sale.pending).toBe(true);
    expect(result?.lines).toHaveLength(1);
    expect(result?.lines[0]).toMatchObject({ returnedQty: 0, remaining: 3 });
    expect(result?.remainingValue).toBe(1500);
  });

  it("detail returns null when neither server nor local knows the sale", async () => {
    api.sales.get.mockRejectedValue(new NetworkError("offline"));
    expect(await getSaleDetailWithOfflineFallback(SALE_ID)).toBeNull();
  });

  it("local stock moves are listed for the offline fallback", async () => {
    const productId = newEntityId();
    const now = Date.now();
    await getLocalDb().stockMoves.put({
      id: newEntityId(),
      businessId: BIZ,
      productId,
      delta: 5,
      reason: "surtir",
      unitCost: 100,
      supplierId: null,
      refType: "purchase",
      refId: null,
      note: null,
      requestId: null,
      occurredOn: "2026-09-20",
      createdAt: now,
    });
    const moves = await listLocalStockMoves(productId);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ productId, delta: 5, reason: "surtir" });
  });
});
