import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { getPwaAuthSession } from "@/data/http/session";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { newEntityId } from "@/data/local/ids";
import { getOutboxStore, resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { createPaymentWithOfflineFallback, syncPendingPayments } from "./offline-payments";
import { discardOutboxOperation } from "./sync-tray";
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

describe("C01.3 QA-01 — clientEvent retry must not send optimisticApplied", () => {
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
  });

  async function discardedTrace() {
    api.customers.pay.mockRejectedValueOnce(new NetworkError("offline"));
    const pay = await createPaymentWithOfflineFallback(
      { customerId, amount: 20_000, method: "Efectivo" },
      newEntityId(),
    );
    const id = (pay as { paymentId: string }).paymentId;
    api.customers.pay.mockRejectedValueOnce(new ApiError("CLOSED_DAY", "x", 409));
    await syncPendingPayments(BIZ);
    await discardOutboxOperation(BIZ, id);
    const traces = (await getLocalDb().outbox.toArray()).filter((r) => r.entity === "clientEvent");
    const discarded = traces.find((e) => (e.payload as { kind?: string }).kind === "discarded");
    expect(discarded).toBeDefined();
    return discarded!;
  }

  it("after a 403, Reintentar envía un body sin optimisticApplied y termina en 201", async () => {
    const discarded = await discardedTrace();
    const calls: unknown[] = [];
    let discardedAttempts = 0;
    api.audit.record.mockImplementation(async (body: Record<string, unknown>) => {
      calls.push(body);
      if (body.kind === "discarded") {
        discardedAttempts += 1;
        if (discardedAttempts === 1) {
          throw new ApiError("FORBIDDEN", "Sin permiso.", 403);
        }
      }
      return { id: newEntityId() };
    });

    await syncPendingOperations(BIZ);
    const after403 = await getOutboxStore().get(BIZ, discarded.operationId);
    expect(after403?.status).toBe("failed");
    expect(after403?.payload as Record<string, unknown>).not.toHaveProperty("optimisticApplied");

    await getLocalDb().outbox.update(discarded.operationId, { nextAttemptAt: Date.now() - 1 });
    await syncPendingOperations(BIZ);

    const discardedBodies = calls.filter((c) => (c as { kind?: string }).kind === "discarded") as Record<string, unknown>[];
    expect(discardedBodies.length).toBeGreaterThanOrEqual(2);
    for (const body of discardedBodies) {
      expect(body).not.toHaveProperty("optimisticApplied");
      expect(body).not.toHaveProperty("optimisticAppliedAt");
    }
    expect((await getOutboxStore().get(BIZ, discarded.operationId))?.status).toBe("synced");
  });
});
