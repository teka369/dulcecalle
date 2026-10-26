import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { getPwaAuthSession } from "@/data/http/session";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { cashStore } from "@/store/cashStore";
import { openCashWithOfflineFallback, recordAporteOffline, syncPendingOperations, todayLocal } from "./offline-operations";
import { createSaleWithOfflineFallback, listSalesForScreen, syncPendingSales } from "./offline-sales";

const BIZ = "11111111-1111-4111-8111-111111111111";
const PROD_ID = "22222222-2222-4222-8222-222222222222";

const api = {
  session: { businessId: BIZ },
  sales: { list: vi.fn(), create: vi.fn(), get: vi.fn(), returns: vi.fn() },
  cash: {
    today: vi.fn(),
    expenses: vi.fn(),
    open: vi.fn(),
    aporte: vi.fn(),
  },
};

vi.mock("./api", () => ({
  getPwaApi: () => api,
  getPrepPwaApi: () => api,
}));

describe("R2-A A3: online /ventas and /mas/caja keep pending offline ops visible until synced", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    getPwaAuthSession().businessId = BIZ;
    const now = Date.now();
    await getLocalDb().products.put({
      id: PROD_ID,
      businessId: BIZ,
      name: "Gomitas",
      category: "General",
      price: 1_500,
      avgCost: 400,
      stock: 10,
      lowStockAt: 2,
      sellable: true,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      images: [],
    });
  });

  it("online listSalesForScreen includes an unsynced offline sale (pending: true) and deduplicates once synced", async () => {
    const serverExisting = {
      id: "55555555-5555-4555-8555-555555555555",
      customerId: null,
      paymentKind: "paid",
      method: "Efectivo",
      saleTotal: 3_000,
      amountReceived: 3_000,
      credit: 0,
      note: null,
      occurredOn: todayLocal(),
      createdAt: Date.now() - 10_000,
      lines: [],
    };

    // 1. Create a sale while offline
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    const created = await createSaleWithOfflineFallback(
      { lines: [{ productId: PROD_ID, qty: 2, unitPrice: 1_500 }], paymentKind: "paid", method: "Efectivo", amountReceived: 3_000 },
      newEntityId(),
    );
    if (created.mode !== "offline") throw new Error("expected offline sale");

    // 2. Back online BEFORE syncPendingSales runs: server only knows serverExisting
    api.sales.list.mockResolvedValueOnce([serverExisting]);
    const beforeSync = await listSalesForScreen();
    expect(beforeSync.source).toBe("server");
    expect(beforeSync.sales).toHaveLength(2);
    const pendingRow = beforeSync.sales.find((s) => s.id === created.saleId);
    expect(pendingRow).toBeDefined();
    expect(pendingRow?.pending).toBe(true);

    // 3. Sync finishes: server now returns both serverExisting and the newly synced sale (with server UUID)
    const serverNewId = "66666666-6666-4666-8666-666666666666";
    const localOp = await getOutboxStore().get(BIZ, created.saleId);
    const localLineId = ((localOp?.payload as { lines: Array<{ id: string }> }).lines[0])!.id;
    const syncedRemoteSale = {
      id: serverNewId,
      customerId: null,
      paymentKind: "paid",
      method: "Efectivo",
      saleTotal: 3_000,
      amountReceived: 3_000,
      credit: 0,
      note: null,
      occurredOn: todayLocal(),
      createdAt: Date.now(),
      lines: [{ id: localLineId, productId: PROD_ID, productName: "Gomitas", qty: 2, unitPrice: 1_500, unitCost: 400, lineTotal: 3_000 }],
    };
    api.sales.create.mockResolvedValueOnce(syncedRemoteSale);
    await syncPendingSales(BIZ);

    api.sales.list.mockResolvedValueOnce([syncedRemoteSale, serverExisting]);
    const afterSync = await listSalesForScreen();
    expect(afterSync.sales).toHaveLength(2);
    expect(afterSync.sales.every((s) => s.pending === false)).toBe(true);
    expect(afterSync.sales.map((s) => s.id)).toEqual([serverNewId, serverExisting.id]);
  });

  it("online cashStore.refresh preserves an unsynced offline open session and pending aporte until synced", async () => {
    const today = todayLocal();
    // 1. Open caja offline (base 9.000) + offline aporte (5.000)
    api.cash.open.mockRejectedValueOnce(new NetworkError("offline"));
    const openRes = await openCashWithOfflineFallback(9_000, newEntityId());
    if (openRes.mode !== "offline") throw new Error("expected offline open");

    api.cash.aporte.mockRejectedValueOnce(new NetworkError("offline"));
    const aporteRes = await recordAporteOffline({ amount: 5_000, method: "Efectivo" }, newEntityId());
    if (aporteRes.mode !== "offline") throw new Error("expected offline aporte");

    // 2. Back online BEFORE syncPendingOperations completes: server still returns session: null
    api.cash.today.mockResolvedValueOnce({
      localDate: today,
      session: null,
      expected: { efectivo: 0, nequi: 0, total: 0 },
      closed: false,
      pendingCount: 0,
      pendingSessions: [],
      needsReviewCount: 0,
      conflict: false,
      canOpen: true,
      moves: [],
    });
    api.cash.expenses.mockResolvedValueOnce([]);

    const summaryBeforeSync = await cashStore.refresh();
    expect(summaryBeforeSync.session).not.toBeNull();
    expect(summaryBeforeSync.session?.openingFloat).toBe(9_000);
    expect(summaryBeforeSync.expected.efectivo).toBe(14_000);
    expect(summaryBeforeSync.canOpen).toBe(false);

    // 3. Sync finishes: server now returns the synced session and move
    const serverSessionId = "77777777-7777-4777-8777-777777777777";
    const serverMoveId = "88888888-8888-4888-8888-888888888888";
    api.cash.open.mockResolvedValueOnce({
      id: serverSessionId,
      localDate: today,
      openedAt: Date.now(),
      closedAt: null,
      openingFloat: 9_000,
      closingCount: null,
      expectedEfectivo: null,
      expectedNequi: null,
      difference: null,
    });
    api.cash.aporte.mockResolvedValueOnce({
      id: serverMoveId,
      amount: 5_000,
      direction: "in",
      method: "Efectivo",
      kind: "aporte",
      refType: null,
      refId: null,
      occurredOn: today,
      createdAt: Date.now(),
    });
    await syncPendingOperations(BIZ);

    api.cash.today.mockResolvedValueOnce({
      localDate: today,
      session: {
        id: serverSessionId,
        localDate: today,
        openedAt: Date.now(),
        closedAt: null,
        openingFloat: 9_000,
        closingCount: null,
        expectedEfectivo: null,
        expectedNequi: null,
        difference: null,
      },
      expected: { efectivo: 14_000, nequi: 0, total: 14_000 },
      closed: false,
      pendingCount: 0,
      pendingSessions: [],
      needsReviewCount: 0,
      conflict: false,
      canOpen: false,
      moves: [
        {
          id: serverMoveId,
          amount: 5_000,
          direction: "in",
          method: "Efectivo",
          kind: "aporte",
          refType: null,
          refId: null,
          occurredOn: today,
          createdAt: Date.now(),
        },
      ],
    });
    api.cash.expenses.mockResolvedValueOnce([]);

    const summaryAfterSync = await cashStore.refresh();
    expect(summaryAfterSync.session?.id).toBe(serverSessionId);
    expect(summaryAfterSync.expected.efectivo).toBe(14_000);
    expect(summaryAfterSync.moves).toHaveLength(1);
  });
});
