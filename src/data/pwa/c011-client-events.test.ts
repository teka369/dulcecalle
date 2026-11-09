import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { getPwaAuthSession } from "@/data/http/session";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { createPaymentWithOfflineFallback, syncPendingPayments } from "./offline-payments";

import { discardOutboxOperation } from "./sync-tray";
import { getOutboxStore } from "@/data/local/outbox";
import { syncPendingOperations } from "./offline-operations";
import { listTrayOperations } from "./sync-tray";

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
  audit: { record: vi.fn(), list: vi.fn() },
};
vi.mock("./api", () => ({ getPwaApi: () => api, getPrepPwaApi: () => api }));


describe("C01.1 — server trace of rejections and discards (C01-INV-04)", () => {
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

  async function events() {
    return (await getLocalDb().outbox.toArray()).filter((r) => r.entity === "clientEvent");
  }

  it("a permanent rejection enqueues exactly one «rejected» trace event (idempotent)", async () => {
    const id = await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "No se puede editar el día.", 409));
    await syncPendingPayments(BIZ);
    const op = await getOutboxStore().get(BIZ, id);
    await getOutboxStore().enqueueClientEvent(op!, "rejected", {});
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ operationId: id, kind: "rejected", amount: 20_000, customerId, rejectionCode: "CLOSED_DAY", entity: "customerPayment" });
  });

  it("a retryable failure does not enqueue a trace", async () => {
    const id = await offlineAbono(20_000);
    await getOutboxStore().markInFlight(BIZ, id);
    await getOutboxStore().markFailed(BIZ, id, "red", Date.now() + 60_000);
    expect(await events()).toHaveLength(0);
  });

  it("Descartar enqueues a «discarded» trace; the trace itself cannot be discarded and is hidden from the tray", async () => {
    const id = await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "No se puede editar el día.", 409));
    await syncPendingPayments(BIZ);
    await discardOutboxOperation(BIZ, id);
    const ev = await events();
    expect(ev.map((e) => (e.payload as { kind: string }).kind).sort()).toEqual(["discarded", "rejected"]);
    for (const e of ev) {
      await expect(getOutboxStore().discard(BIZ, e.operationId)).rejects.toThrow(/no se puede descartar/);
    }
    expect((await listTrayOperations(BIZ)).some((t) => t.entity === "clientEvent")).toBe(false);
  });

  it("a correction marks the trace as «replaced» with replacedBy", async () => {
    const id = await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "x", 409));
    await syncPendingPayments(BIZ);
    const replacement = newEntityId();
    await discardOutboxOperation(BIZ, id, { replacedBy: replacement });
    const replaced = (await events()).find((e) => (e.payload as { kind: string }).kind === "replaced");
    expect(replaced?.payload).toMatchObject({ operationId: id, replacedBy: replacement });
  });

  it("the trace syncs to POST /audit/client-events with its own idempotency key", async () => {
    const id = await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "x", 409));
    await syncPendingPayments(BIZ);
    api.audit.record.mockResolvedValue({ id: newEntityId() });
    await syncPendingOperations(BIZ);
    expect(api.audit.record).toHaveBeenCalledWith(expect.objectContaining({ operationId: id, kind: "rejected" }), expect.any(String));
    expect((await events()).every((e) => e.status === "synced")).toBe(true);
  });
});
