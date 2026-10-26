import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { getPwaAuthSession } from "@/data/http/session";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import {
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { createInitialDebtWithOfflineFallback, syncPendingInitialDebts } from "./offline-initial-debt";
import {
  getLocalCashSnapshot,
  recordAporteOffline,
  recordExpenseWithOfflineFallback,
  shrinkWithOfflineFallback,
  surtirWithOfflineFallback,
  syncPendingOperations,
} from "./offline-operations";
import { createPaymentWithOfflineFallback, syncPendingPayments } from "./offline-payments";
import { prepararWithOfflineFallback, syncPendingPreparations } from "./offline-production";
import { createSaleWithOfflineFallback, listLocalSales, syncPendingSales } from "./offline-sales";
import { getStatementWithOfflineFallback } from "./offline-statement";
import { discardOutboxOperation } from "./sync-tray";

const BIZ = "11111111-1111-4111-8111-111111111111";

const api = {
  session: { businessId: BIZ },
  sales: { create: vi.fn(), list: vi.fn(), get: vi.fn(), returns: vi.fn() },
  customers: { get: vi.fn(), pay: vi.fn(), initialDebt: vi.fn(), ledger: vi.fn() },
  cash: {
    open: vi.fn(),
    close: vi.fn(),
    carry: vi.fn(),
    assignMove: vi.fn(),
    aporte: vi.fn(),
    retiro: vi.fn(),
    recordExpense: vi.fn(),
  },
  inventory: { surtir: vi.fn(), shrink: vi.fn() },
  production: { prepare: vi.fn(), list: vi.fn() },
};

vi.mock("./api", () => ({
  getPwaApi: () => api,
  getPrepPwaApi: () => api,
}));

describe("R2-A A1: optimistic Dexie rows are cleaned on permanent rejection and discard", () => {
  const customerId = "22222222-2222-4222-8222-222222222222";
  const prodId = "33333333-3333-4333-8333-333333333333";
  const insumoId = "44444444-4444-4444-8444-444444444444";

  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    getPwaAuthSession().businessId = BIZ;
    const now = Date.now();
    await getLocalDb().customers.put({
      id: customerId,
      businessId: BIZ,
      code: "DC-0001",
      name: "Marta",
      phone: null,
      debt: 50_000,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await getLocalDb().products.put({
      id: prodId,
      businessId: BIZ,
      name: "Gomitas",
      category: "General",
      price: 2_000,
      avgCost: 500,
      stock: 10,
      lowStockAt: 2,
      sellable: true,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      images: [],
    });
    await getLocalDb().products.put({
      id: insumoId,
      businessId: BIZ,
      name: "Azúcar Lote",
      category: "General",
      price: 0,
      avgCost: 10_000,
      stock: 2,
      lowStockAt: 1,
      sellable: false,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      images: [],
    });
  });

  it("rejected credit sale, payment, and initialDebt do NOT reappear in statement or /ventas after Descartar", async () => {
    // 1. Offline initialDebt (+10.000), credit sale (+6.000), payment (-5.000)
    api.customers.initialDebt.mockRejectedValueOnce(new NetworkError("offline"));
    const debt = await createInitialDebtWithOfflineFallback({ customerId, amount: 10_000 }, newEntityId());
    if (debt.mode !== "offline") throw new Error("expected offline");

    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    const sale = await createSaleWithOfflineFallback(
      { lines: [{ productId: prodId, qty: 3, unitPrice: 2_000 }], paymentKind: "credit", customerId, amountReceived: 0 },
      newEntityId(),
    );
    if (sale.mode !== "offline") throw new Error("expected offline");

    api.customers.pay.mockRejectedValueOnce(new NetworkError("offline"));
    const pay = await createPaymentWithOfflineFallback({ customerId, amount: 5_000, method: "Efectivo" }, newEntityId());
    if (pay.mode !== "offline") throw new Error("expected offline");

    // 2. Server rejects all 3 permanently (409/400)
    api.customers.initialDebt.mockRejectedValueOnce(new ApiError("VALIDATION", "Rechazada", 400));
    api.sales.create.mockRejectedValueOnce(new ApiError("CONFLICT", "Caja cerrada", 409));
    api.customers.pay.mockRejectedValueOnce(new ApiError("CONFLICT", "Abono mayor", 409));

    await syncPendingInitialDebts(BIZ);
    await syncPendingSales(BIZ);
    await syncPendingPayments(BIZ);

    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(50_000);
    expect((await getLocalDb().products.get(prodId))?.stock).toBe(10);

    // 3. User clicks Descartar on all 3 rejected operations
    await discardOutboxOperation(BIZ, debt.debtId);
    await discardOutboxOperation(BIZ, sale.saleId);
    await discardOutboxOperation(BIZ, pay.paymentId);

    // Debt and stock must not be double-reverted
    expect((await getLocalDb().customers.get(customerId))?.debt).toBe(50_000);
    expect((await getLocalDb().products.get(prodId))?.stock).toBe(10);

    // Offline statement must have 0 entries from those discarded operations
    api.customers.ledger.mockRejectedValueOnce(new NetworkError("offline"));
    const st = await getStatementWithOfflineFallback(customerId);
    expect(st?.statement.total).toBe(50_000);
    expect(st?.statement.entries).toEqual([]);

    // Local sales list (/ventas) must not show the discarded sale
    expect(await listLocalSales(BIZ)).toEqual([]);
  });

  it("permanent 409 rejection + discard of aporte, gasto, surtir, shrink, and preparation reverts Caja/Gastos/Stock once", async () => {
    // Queue offline aporte (+4.000), gasto (-1.500), surtir (+5 units @ 600 = 3.000), shrink (-2 units), preparation (+4 units @ 500 = 2.000)
    api.cash.aporte.mockRejectedValueOnce(new NetworkError("offline"));
    const aporte = await recordAporteOffline({ amount: 4_000, method: "Efectivo" }, newEntityId());
    if (aporte.mode !== "offline") throw new Error("expected offline");

    api.cash.recordExpense.mockRejectedValueOnce(new NetworkError("offline"));
    const gasto = await recordExpenseWithOfflineFallback(
      { amount: 1_500, category: "Bolsas", method: "Efectivo" },
      newEntityId(),
    );
    if (gasto.mode !== "offline") throw new Error("expected offline");

    api.inventory.surtir.mockRejectedValueOnce(new NetworkError("offline"));
    const surtir = await surtirWithOfflineFallback(
      { productId: prodId, qty: 5, unitCost: 600, totalCost: 3_000, method: "Efectivo" },
      newEntityId(),
    );
    if (surtir.mode !== "offline") throw new Error("expected offline");

    api.inventory.shrink.mockRejectedValueOnce(new NetworkError("offline"));
    const shrink = await shrinkWithOfflineFallback(
      { productId: prodId, qty: 2, reason: "me_lo_comi" },
      newEntityId(),
    );
    if (shrink.mode !== "offline") throw new Error("expected offline");

    // Optimistic state before rejection of operations:
    // prodId stock: 10 + 5 - 2 = 13
    expect((await getLocalDb().products.get(prodId))?.stock).toBe(13);

    // Server rejects each operation with 409 CONFLICT (e.g. closed day)
    const closedErr = new ApiError("CLOSED_DAY", "La caja de hoy ya está cerrada.", 409);
    api.cash.aporte.mockRejectedValue(closedErr);
    api.cash.recordExpense.mockRejectedValue(closedErr);
    api.inventory.surtir.mockRejectedValue(closedErr);
    api.inventory.shrink.mockRejectedValue(closedErr);
    api.production.prepare.mockRejectedValue(closedErr);

    await syncPendingOperations(BIZ);
    await discardOutboxOperation(BIZ, surtir.id);
    await discardOutboxOperation(BIZ, shrink.id);

    // Now queue offline preparation (+4 units @ 500 = 2.000) and reject with 409:
    api.production.prepare.mockRejectedValueOnce(new NetworkError("offline"));
    const prep = await prepararWithOfflineFallback(
      { sourceId: insumoId, targetId: prodId, qty: 4, unitCost: 500 },
      newEntityId(),
    );
    if (prep.mode !== "offline") throw new Error("expected offline");
    expect((await getLocalDb().products.get(prodId))?.stock).toBe(14);
    expect((await getLocalDb().products.get(insumoId))?.avgCost).toBe(8_000);

    await syncPendingPreparations(BIZ);

    // After permanent rejection, local Caja, Gastos, and Stock must be reverted to baseline:
    const cashAfterReject = await getLocalCashSnapshot();
    expect(cashAfterReject.summary.expected.efectivo).toBe(0);
    expect(cashAfterReject.summary.moves).toHaveLength(0);
    expect(cashAfterReject.expenses).toHaveLength(0);
    expect((await getLocalDb().products.get(prodId))?.stock).toBe(10);
    expect((await getLocalDb().products.get(prodId))?.avgCost).toBe(500);
    expect((await getLocalDb().products.get(insumoId))?.avgCost).toBe(10_000);
    expect(await getLocalDb().preparations.count()).toBe(0);

    // Discarding the rejected ops must not double-revert stock or cost:
    await discardOutboxOperation(BIZ, aporte.id);
    await discardOutboxOperation(BIZ, gasto.id);
    await discardOutboxOperation(BIZ, prep.id);

    expect((await getLocalDb().products.get(prodId))?.stock).toBe(10);
    expect((await getLocalDb().products.get(prodId))?.avgCost).toBe(500);
    expect((await getLocalDb().products.get(insumoId))?.avgCost).toBe(10_000);
  });
});
