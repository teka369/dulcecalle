import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { getPwaAuthSession } from "@/data/http/session";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { CatalogReadCache } from "@/data/local/read-cache";
import { getLocalStore } from "@/data/local/store";
import { closeCashWithOfflineFallback } from "./offline-operations";
import { createPaymentWithOfflineFallback, syncPendingPayments } from "./offline-payments";
import { createSaleWithOfflineFallback, syncPendingSales } from "./offline-sales";
import { discardOutboxOperation, retryOutboxOperation } from "./sync-tray";
import { listUnresolvedFinancialOps } from "./unresolved-financial";

const BIZ = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const prodId = "33333333-3333-4333-8333-333333333333";

const api = {
  session: { businessId: BIZ },
  sales: { create: vi.fn(), list: vi.fn(), get: vi.fn(), returns: vi.fn() },
  customers: { get: vi.fn(), pay: vi.fn(), initialDebt: vi.fn(), ledger: vi.fn() },
  cash: { open: vi.fn(), close: vi.fn(), carry: vi.fn(), assignMove: vi.fn(), aporte: vi.fn(), retiro: vi.fn(), recordExpense: vi.fn() },
  inventory: { surtir: vi.fn(), shrink: vi.fn() },
  production: { prepare: vi.fn(), list: vi.fn() },
};
vi.mock("./api", () => ({ getPwaApi: () => api, getPrepPwaApi: () => api }));

async function debt() {
  return (await getLocalDb().customers.get(customerId))?.debt;
}

describe("C01 — rejected financial operations never vanish", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    getPwaAuthSession().businessId = BIZ;
    const now = Date.now();
    await getLocalDb().customers.put({ id: customerId, businessId: BIZ, code: "DC-0001", name: "Marta", phone: null, debt: 50_000, archivedAt: null, createdAt: now, updatedAt: now });
    await getLocalDb().products.put({ id: prodId, businessId: BIZ, name: "Gomitas", category: "General", price: 2_000, avgCost: 500, stock: 10, lowStockAt: 2, sellable: true, archivedAt: null, createdAt: now, updatedAt: now, images: [] });
  });

  async function offlineAbono(amount: number) {
    api.customers.pay.mockRejectedValueOnce(new NetworkError("offline"));
    const pay = await createPaymentWithOfflineFallback({ customerId, amount, method: "Efectivo" }, newEntityId());
    expect(pay.mode).toBe("offline");
    return (pay as { paymentId: string }).paymentId;
  }

  it("R2: a rejected offline abono stays as a visible, unresolved record with its Spanish reason", async () => {
    const id = await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "No se puede editar el día.", 409));
    await syncPendingPayments(BIZ);
    const op = await getLocalDb().outbox.get(id);
    expect(op?.status).toBe("failed");
    expect(op?.rejection?.code).toBe("CLOSED_DAY");
    expect(op?.lastError).toBe("No se puede editar el día.");
    expect(await getLocalDb().customerPayments.get(id)).toBeTruthy();
    const unresolved = await listUnresolvedFinancialOps(BIZ);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]).toMatchObject({ operationId: id, state: "rejected", amount: 20_000, customerId, reason: "No se puede editar el día." });
    // the rejection never changes the local debt nor deletes the cash move (UX-C01 §9.2)
    expect(await debt()).toBe(30_000);
    const cash = (await getLocalDb().cashMoves.toArray()).filter((m) => m.kind === "debt_collect");
    expect(cash).toHaveLength(1);
  });

  it("R2b: a server refresh after the rejection keeps the rejected abono counted once (no double count)", async () => {
    await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "No se puede editar el día.", 409));
    await syncPendingPayments(BIZ);
    const cache = new CatalogReadCache(getLocalStore(), getLocalDb());
    const server = { id: customerId, code: "DC-0001", name: "Marta", phone: null, debt: 50_000, archivedAt: null, createdAt: 1 };
    const first = await cache.listCustomers(BIZ, async () => [server]);
    const second = await cache.listCustomers(BIZ, async () => [server]);
    expect(first.data[0].debt).toBe(30_000);
    expect(second.data[0].debt).toBe(30_000);
  });

  it("R3 / F-04: fiada + abono both rejected restore the exact prior debt (no clamp drift)", async () => {
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    const sale = await createSaleWithOfflineFallback(
      { lines: [{ productId: prodId, qty: 3, unitPrice: 2_000 }], paymentKind: "credit", customerId, amountReceived: 0 },
      newEntityId(),
    );
    expect(sale.mode).toBe("offline");
    await offlineAbono(56_000);
    expect(await debt()).toBe(0);
    api.sales.create.mockRejectedValueOnce(new ApiError("INSUFFICIENT_STOCK", "No hay suficiente stock.", 409));
    api.customers.pay.mockRejectedValueOnce(new ApiError("ABONO_EXCEEDS_DEBT", "El abono no puede ser mayor al saldo.", 409));
    await syncPendingSales(BIZ);
    await syncPendingPayments(BIZ);
    // rejection: nothing changes locally
    expect(await debt()).toBe(0);
    const ops = await listUnresolvedFinancialOps(BIZ);
    expect(ops.map((u) => u.state)).toEqual(["rejected", "rejected"]);
    // explicit discard of both lands exactly on the prior debt (DC-15: no clamp drift)
    for (const op of ops) await discardOutboxOperation(BIZ, op.operationId);
    expect(await debt()).toBe(50_000);
  });

  it("Reintentar re-applies the abono once and resolves it when the server accepts", async () => {
    const id = await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "No se puede editar el día.", 409));
    await syncPendingPayments(BIZ);
    await retryOutboxOperation(BIZ, id);
    api.customers.pay.mockResolvedValueOnce({ id: newEntityId(), customerId, amount: 20_000, method: "Efectivo", note: null, occurredOn: "2026-11-03", createdAt: new Date().toISOString() });
    await syncPendingPayments(BIZ);
    expect(await debt()).toBe(30_000);
    expect(await listUnresolvedFinancialOps(BIZ)).toHaveLength(0);
  });

  it("DC-14: Descartar leaves an auditable local trace of the discarded money operation", async () => {
    const id = await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "No se puede editar el día.", 409));
    await syncPendingPayments(BIZ);
    await discardOutboxOperation(BIZ, id);
    const trail = await getLocalDb().discardedOps.where("businessId").equals(BIZ).toArray();
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({ operationId: id, entity: "customerPayment", amount: 20_000, customerId, lastError: "No se puede editar el día." });
    expect(trail[0].state).toBe("discarded");
    expect(typeof trail[0].discardedAt).toBe("number");
    expect(await listUnresolvedFinancialOps(BIZ)).toHaveLength(0);
    // the explicit discard is what undoes the local effect
    expect(await debt()).toBe(50_000);
  });

  async function openSession() {
    const sid = newEntityId();
    const now = Date.now();
    await getLocalDb().cashSessions.put({ id: sid, businessId: BIZ, localDate: "2026-11-03", openedAt: now, closedAt: null, openingFloat: 0, closingCount: null, expectedEfectivo: null, expectedNequi: null, difference: null, note: null, createdAt: now, updatedAt: now });
    api.cash.close.mockResolvedValue({ id: sid, localDate: "2026-11-03", openedAt: now, closedAt: now, openingFloat: 0, closingCount: 0, expectedEfectivo: 0, expectedNequi: 0, difference: 0 });
    return sid;
  }

  it("caja close with a rejected money op needs «Cerrar igual» and then carries a traceable mark", async () => {
    await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "No se puede editar el día.", 409));
    await syncPendingPayments(BIZ);
    const sid = await openSession();
    await expect(closeCashWithOfflineFallback(sid, 0, newEntityId())).rejects.toThrow(/sin resolver/);
    expect(api.cash.close).not.toHaveBeenCalled();
    await closeCashWithOfflineFallback(sid, 0, newEntityId(), { closeAnyway: true });
    expect(api.cash.close).toHaveBeenCalledTimes(1);
    expect(api.cash.close.mock.calls[0][3]).toEqual({ count: 1, amount: 20_000 });
    const session = await getLocalDb().cashSessions.get(sid);
    expect(session?.unresolvedCount).toBe(1);
    expect(session?.unresolvedAmount).toBe(20_000);
  });

  it("caja close with only pending money ops is allowed (warning only, no mark)", async () => {
    await offlineAbono(20_000);
    const sid = await openSession();
    await closeCashWithOfflineFallback(sid, 0, newEntityId());
    expect(api.cash.close).toHaveBeenCalledTimes(1);
    expect(api.cash.close.mock.calls[0][3]).toBeUndefined();
  });
});
