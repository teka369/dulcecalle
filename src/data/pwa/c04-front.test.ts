/**
 * C04 — front acceptance on the PWA data layer (fake IndexedDB, mocked API).
 * T20 local projection replaced on sync (no double subtract), T21 offline
 * overpay, T33 return remainder explicit (default saldo a favor), T34 saldo a
 * favor never offline / never queued, and the outbox dependency of an abono
 * that targets a still-local sale.
 */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { getPwaAuthSession } from "@/data/http/session";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { CatalogReadCache, resetCatalogReadCache } from "@/data/local/read-cache";
import { getLocalStore, resetLocalStoreSingleton } from "@/data/local/store";
import { createPaymentWithOfflineFallback, syncPendingPayments } from "./offline-payments";
import { createSaleWithOfflineFallback, SALDO_NEEDS_CONNECTION } from "./offline-sales";
import { createReturnWithOfflineFallback } from "./offline-returns";
import { discardOutboxOperation } from "./sync-tray";
import { loadEstimate } from "./customer-allocations";
import { saldoAFavorView } from "@/components/sale/saldo-a-favor";
import { wireTarget } from "@/components/customers/abono-target";

const BIZ = "11111111-1111-4111-8111-111111111111";
const customerId = "22222222-2222-4222-8222-222222222222";
const prodId = "33333333-3333-4333-8333-333333333333";

const api = {
  session: { businessId: BIZ },
  sales: { create: vi.fn(), list: vi.fn(), get: vi.fn(), returns: vi.fn(), createReturn: vi.fn() },
  customers: { get: vi.fn(), pay: vi.fn(), initialDebt: vi.fn(), ledger: vi.fn() },
  cash: { open: vi.fn(), close: vi.fn() },
  inventory: { surtir: vi.fn(), shrink: vi.fn() },
  production: { prepare: vi.fn(), list: vi.fn() },
};
vi.mock("./api", () => ({ getPwaApi: () => api, getPrepPwaApi: () => api }));

const server = (debt: number, creditBalance = 0) => ({
  id: customerId,
  code: "DC-0001",
  name: "Ana Pérez",
  phone: null,
  debt,
  creditBalance,
  archivedAt: null,
  createdAt: 1,
});

async function localDebt() {
  return (await getLocalDb().customers.get(customerId))?.debt;
}

async function offlineAbono(amount: number, extra: Record<string, unknown> = {}) {
  api.customers.pay.mockRejectedValueOnce(new NetworkError("offline"));
  const pay = await createPaymentWithOfflineFallback(
    { customerId, amount, method: "Efectivo", ...extra },
    newEntityId(),
  );
  expect(pay.mode).toBe("offline");
  return (pay as { paymentId: string }).paymentId;
}

describe("C04 front — imputación de abonos", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    getPwaAuthSession().businessId = BIZ;
    const now = Date.now();
    await getLocalDb().customers.put({ id: customerId, businessId: BIZ, code: "DC-0001", name: "Ana Pérez", phone: null, debt: 50_000, creditBalance: 2_000, archivedAt: null, createdAt: now, updatedAt: now });
    await getLocalDb().products.put({ id: prodId, businessId: BIZ, name: "Gomitas", category: "General", price: 2_000, avgCost: 500, stock: 10, lowStockAt: 2, sellable: true, archivedAt: null, createdAt: now, updatedAt: now, images: [] });
  });

  it("T20: local projection before sync, replaced by the server after sync (no double subtract)", async () => {
    await offlineAbono(20_000);
    expect(await localDebt()).toBe(30_000);
    const cache = new CatalogReadCache(getLocalStore(), getLocalDb());
    // Server has not seen it yet: snapshot 50.000 + pending −20.000.
    expect((await cache.listCustomers(BIZ, async () => [server(50_000)])).data[0].debt).toBe(30_000);
    api.customers.pay.mockResolvedValueOnce({ id: newEntityId(), customerId, amount: 20_000, method: "Efectivo", note: null, occurredOn: "2026-11-09", createdAt: new Date().toISOString(), debtAfter: 30_000 });
    await syncPendingPayments(BIZ);
    // Server now includes it: 30.000, never 10.000.
    expect((await cache.listCustomers(BIZ, async () => [server(30_000)])).data[0].debt).toBe(30_000);
    const body = api.customers.pay.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("projectedToDebt");
    expect(body).not.toHaveProperty("projectedToCredit");
  });

  it("T21: offline overpay is allowed; debt stays ≥ 0 and the excess is the estimated saldo a favor", async () => {
    const id = await offlineAbono(70_000);
    expect(await localDebt()).toBe(0);
    const op = await getLocalDb().outbox.get(id);
    expect(op?.payload).toMatchObject({ amount: 70_000, projectedToDebt: 50_000, projectedToCredit: 20_000 });
    const cache = new CatalogReadCache(getLocalStore(), getLocalDb());
    expect((await cache.listCustomers(BIZ, async () => [server(50_000)])).data[0].debt).toBe(0);
    api.customers.pay.mockResolvedValueOnce({ id: newEntityId(), customerId, amount: 70_000, method: "Efectivo", note: null, occurredOn: "2026-11-09", createdAt: new Date().toISOString(), debtAfter: 0, creditBalanceAfter: 22_000 });
    await syncPendingPayments(BIZ);
    expect(api.customers.pay.mock.calls.at(-1)?.[1]).toMatchObject({ amount: 70_000, method: "Efectivo" });
  });

  it("T21: discarding a rejected overpay restores the exact prior debt (only the debt part)", async () => {
    const id = await offlineAbono(70_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "No se puede editar el día.", 409));
    await syncPendingPayments(BIZ);
    await discardOutboxOperation(BIZ, id);
    expect(await localDebt()).toBe(50_000);
  });

  it("an abono to a still-local sale waits for it (dependsOn) and targets it by saleRequestId", async () => {
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    const saleRequestId = newEntityId();
    const sale = await createSaleWithOfflineFallback(
      { lines: [{ productId: prodId, qty: 2, unitPrice: 2_000 }], paymentKind: "credit", customerId, amountReceived: 0 },
      saleRequestId,
    );
    expect(sale.mode).toBe("offline");
    const est = await loadEstimate(customerId);
    const local = est?.obligations.find((o) => o.kind === "sale");
    expect(local?.localRequestId).toBe(saleRequestId);
    const wire = wireTarget({ mode: "sale", obligationId: local!.id }, est!.obligations, "fifo");
    expect(wire.target).toEqual({ mode: "sale", saleRequestId });
    const payId = await offlineAbono(1_000, wire);
    const op = await getLocalDb().outbox.get(payId);
    expect(op?.dependsOn).toEqual([local!.localOperationId]);
    expect(op?.payload).toMatchObject({ target: { mode: "sale", saleRequestId } });
  });

  it("T34: offline, Cobrar never offers «Usar saldo» and the queued sale never carries applyCredit", async () => {
    expect(saldoAFavorView({ creditBalance: 2_000, owedOnSale: 4_000, online: false, using: true })).toMatchObject({
      visible: true,
      offerable: false,
      applied: 0,
    });
    expect(saldoAFavorView({ creditBalance: 2_000, owedOnSale: 4_000, online: true, using: true })).toMatchObject({
      offerable: true,
      applied: 2_000,
      remaining: 2_000,
    });
    // Connection drops after «Usar saldo»: nothing is queued.
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    await expect(
      createSaleWithOfflineFallback(
        { lines: [{ productId: prodId, qty: 2, unitPrice: 2_000 }], paymentKind: "credit", customerId, amountReceived: 0, applyCredit: true },
        newEntityId(),
      ),
    ).rejects.toThrow(SALDO_NEEDS_CONNECTION);
    expect(await getLocalDb().outbox.count()).toBe(0);
    // Without it the sale is queued as before, with no applyCredit.
    api.sales.create.mockRejectedValueOnce(new NetworkError("offline"));
    await createSaleWithOfflineFallback(
      { lines: [{ productId: prodId, qty: 2, unitPrice: 2_000 }], paymentKind: "credit", customerId, amountReceived: 0 },
      newEntityId(),
    );
    const ops = await getLocalDb().outbox.toArray();
    expect(ops).toHaveLength(1);
    expect(JSON.stringify(ops[0].payload)).not.toContain("applyCredit");
  });

  it("T33: a customer return carries remainder explicitly (default saldo a favor), online and offline", async () => {
    const saleId = newEntityId();
    const lineId = newEntityId();
    const now = Date.now();
    await getLocalDb().customers.update(customerId, { debt: 1_000 });
    await getLocalDb().sales.put({ id: saleId, businessId: BIZ, customerId, paymentKind: "partial", method: "Efectivo", saleTotal: 4_000, amountReceived: 3_000, credit: 1_000, requestId: newEntityId(), note: null, occurredOn: "2026-11-09", createdAt: now, updatedAt: now });
    await getLocalDb().saleLines.put({ id: lineId, businessId: BIZ, saleId, productId: prodId, productName: "Gomitas", qty: 2, unitPrice: 2_000, unitCost: 500, lineTotal: 4_000, createdAt: now });
    await getLocalDb().outbox.put({ operationId: saleId, businessId: BIZ, entity: "sale", operation: "create", requestId: newEntityId(), payload: {}, dependsOn: [], localCreatedAt: now, status: "synced", remoteId: saleId, attempts: 0, lastError: null, nextAttemptAt: null });

    api.sales.createReturn.mockResolvedValueOnce({ id: newEntityId(), saleId, refundAmount: 0, debtReduced: 1_000, method: null, note: null, occurredOn: "2026-11-09", createdAt: now, toCredit: 1_000, lines: [] });
    await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 1 }], newEntityId(), "credit");
    expect(api.sales.createReturn.mock.calls.at(-1)?.[1]).toEqual({ lines: [{ saleLineId: lineId, qty: 1 }], remainder: "credit" });

    api.sales.createReturn.mockRejectedValueOnce(new NetworkError("offline"));
    const queued = await createReturnWithOfflineFallback(saleId, [{ saleLineId: lineId, qty: 1 }], newEntityId());
    expect(queued.mode).toBe("offline");
    const op = (await getLocalDb().outbox.toArray()).find((o) => o.entity === "saleReturn");
    expect(op?.payload).toMatchObject({ remainder: "credit", projectedDebtReduced: 1_000, projectedRefundAmount: 0, projectedToCredit: 1_000 });
  });
});
