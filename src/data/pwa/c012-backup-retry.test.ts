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

import { getOutboxStore } from "@/data/local/outbox";
import { syncPendingOperations } from "./offline-operations";

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


import { syncStore } from "@/store/syncStore";
import { backupsPendingText, syncPillLabel } from "./sync-copy";

describe("C01.2 — a server trace survives a transient 4xx (C011-INV-02)", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.audit.record.mockReset();
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

  async function rejectedWithTrace() {
    const id = await offlineAbono(20_000);
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "x", 409));
    await syncPendingPayments(BIZ);
    const [trace] = await events();
    expect(trace).toBeDefined();
    return { id, trace: trace! };
  }

  it("403 then 201: the trace is retried with backoff and ends synced", async () => {
    const { trace } = await rejectedWithTrace();
    api.audit.record.mockRejectedValueOnce(new ApiError("FORBIDDEN", "Sin permiso.", 403));
    await syncPendingOperations(BIZ);
    const failed = await getOutboxStore().get(BIZ, trace.operationId);
    expect(failed?.status).toBe("failed");
    expect(failed?.nextAttemptAt).not.toBeNull();
    await getLocalDb().outbox.update(trace.operationId, { nextAttemptAt: Date.now() - 1 });
    api.audit.record.mockResolvedValueOnce({ id: newEntityId() });
    await syncPendingOperations(BIZ);
    expect((await getOutboxStore().get(BIZ, trace.operationId))?.status).toBe("synced");
    expect(api.audit.record).toHaveBeenCalledTimes(2);
  });

  it("a validation 400 stays a visible permanent failure", async () => {
    const { trace } = await rejectedWithTrace();
    api.audit.record.mockRejectedValueOnce(new ApiError("VALIDATION", "Datos inválidos.", 400));
    await syncPendingOperations(BIZ);
    const failed = await getOutboxStore().get(BIZ, trace.operationId);
    expect(failed?.status).toBe("failed");
    expect(failed?.nextAttemptAt).toBeNull();
    expect(failed?.lastError).toBe("Datos inválidos.");
  });

  it("pending traces are counted as «respaldos pendientes»", async () => {
    await rejectedWithTrace();
    await syncStore.refresh();
    const counts = syncStore.getSnapshot().counts;
    expect(counts.backups).toBe(1);
    expect(backupsPendingText(1)).toBe("1 respaldo pendiente");
    expect(backupsPendingText(2)).toBe("2 respaldos pendientes");
    expect(syncPillLabel(true, { pending: 0, active: 0, failed: 0, permanent: 0, total: 0, backups: 2 }, null)).toBe("○ 2 respaldos pendientes");
  });
});
