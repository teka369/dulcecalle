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
import { newEntityId } from "@/data/local/ids";
import { createSaleWithOfflineFallback } from "./offline-sales";
import { createPaymentWithOfflineFallback } from "./offline-payments";
import { surtirWithOfflineFallback } from "./offline-operations";
import {
  PENDING_CUSTOMER_MESSAGE,
  PENDING_SUPPLIER_MESSAGE,
  createCustomerWithOfflineFallback,
  createSupplierWithOfflineFallback,
  listPendingCustomerIds,
  listPendingSupplierIds,
} from "./offline-catalog";

const businessId = "11111111-1111-4111-8111-111111111111";
const productId = "33333333-3333-4333-8333-333333333333";

const api = {
  session: { businessId },
  sales: { create: vi.fn() },
  customers: { create: vi.fn(), get: vi.fn(), pay: vi.fn() },
  suppliers: { create: vi.fn(), get: vi.fn() },
  cash: {
    open: vi.fn(),
    close: vi.fn(),
    aporte: vi.fn(),
    retiro: vi.fn(),
    recordExpense: vi.fn(),
  },
  inventory: { surtir: vi.fn(), shrink: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({
  getPwaAuthSession: () => api.session,
}));

async function seedProduct() {
  const now = Date.now();
  await getLocalDb().products.put({
    id: productId,
    businessId,
    name: "Gomitas",
    category: "General",
    price: 500,
    avgCost: 100,
    stock: 10,
    lowStockAt: 5,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function offlineCustomer(name: string, debt = 5000): Promise<string> {
  api.customers.create.mockRejectedValue(new NetworkError("offline"));
  const result = await createCustomerWithOfflineFallback({ name }, crypto.randomUUID());
  if (result.mode !== "offline") throw new Error("expected offline");
  await getLocalDb().customers.update(result.customerId, { debt });
  return result.customerId;
}

async function offlineSupplier(name: string): Promise<string> {
  api.suppliers.create.mockRejectedValue(new NetworkError("offline"));
  const result = await createSupplierWithOfflineFallback({ name }, crypto.randomUUID());
  if (result.mode !== "offline") throw new Error("expected offline");
  return result.supplierId;
}

describe("D3 pending references", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = businessId;
  });

  it("lists pending customer and supplier ids while they are not synced", async () => {
    const customerId = await offlineCustomer("Rosa");
    const supplierId = await offlineSupplier("Proveedor");
    expect(await listPendingCustomerIds(businessId)).toEqual([customerId]);
    expect(await listPendingSupplierIds(businessId)).toEqual([supplierId]);
  });

  it("keeps a pending customer visible in listings", async () => {
    const customerId = await offlineCustomer("Rosa");
    const rows = await getLocalDb().customers.where("businessId").equals(businessId).toArray();
    expect(rows.map((r) => r.id)).toContain(customerId);
  });

  it("blocks an offline credit sale to a pending customer", async () => {
    await seedProduct();
    const customerId = await offlineCustomer("Rosa");
    api.sales.create.mockRejectedValue(new NetworkError("offline"));
    await expect(
      createSaleWithOfflineFallback(
        {
          lines: [{ productId, qty: 1 }],
          paymentKind: "credit",
          customerId,
          amountReceived: 0,
        },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow(PENDING_CUSTOMER_MESSAGE);
  });

  it("blocks an offline payment to a pending customer", async () => {
    const customerId = await offlineCustomer("Rosa");
    api.customers.pay.mockRejectedValue(new NetworkError("offline"));
    await expect(
      createPaymentWithOfflineFallback(
        { customerId, amount: 1000, method: "Efectivo" },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow(PENDING_CUSTOMER_MESSAGE);
  });

  it("blocks an offline surtir with a pending supplier", async () => {
    await seedProduct();
    const supplierId = await offlineSupplier("Proveedor");
    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    await expect(
      surtirWithOfflineFallback(
        {
          productId,
          qty: 2,
          unitCost: 100,
          totalCost: 200,
          method: "Efectivo",
          supplierId,
        },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow(PENDING_SUPPLIER_MESSAGE);
  });

  it("allows the reference once the entity is synced and reconciled", async () => {
    await seedProduct();
    const customerId = await offlineCustomer("Rosa");
    const supplierId = await offlineSupplier("Proveedor");

    const outbox = getOutboxStore();
    const ops = await outbox.listPending(businessId);
    for (const op of ops) {
      await outbox.markInFlight(businessId, op.operationId);
      await outbox.markSynced(businessId, op.operationId, newEntityId());
    }
    // Reconciled rows lose the pending requestId (server owns identity now).
    await getLocalDb().customers.update(customerId, { requestId: undefined });
    await getLocalDb().suppliers.update(supplierId, { requestId: undefined });
    expect(await listPendingCustomerIds(businessId)).toEqual([]);
    expect(await listPendingSupplierIds(businessId)).toEqual([]);

    api.sales.create.mockRejectedValue(new NetworkError("offline"));
    const sale = await createSaleWithOfflineFallback(
      {
        lines: [{ productId, qty: 1 }],
        paymentKind: "credit",
        customerId,
        amountReceived: 0,
      },
      crypto.randomUUID(),
    );
    expect(sale.mode).toBe("offline");

    api.customers.pay.mockRejectedValue(new NetworkError("offline"));
    const payment = await createPaymentWithOfflineFallback(
      { customerId, amount: 1000, method: "Efectivo" },
      crypto.randomUUID(),
    );
    expect(payment.mode).toBe("offline");

    api.inventory.surtir.mockRejectedValue(new NetworkError("offline"));
    const surtir = await surtirWithOfflineFallback(
      {
        productId,
        qty: 2,
        unitCost: 100,
        totalCost: 200,
        method: "Efectivo",
        supplierId,
      },
      crypto.randomUUID(),
    );
    expect(surtir.mode).toBe("offline");
  });

  it("leaves the online flow unchanged", async () => {
    await seedProduct();
    const remoteId = newEntityId();
    api.sales.create.mockResolvedValue({ id: remoteId });
    const result = await createSaleWithOfflineFallback(
      {
        lines: [{ productId, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 500,
        method: "Efectivo",
      },
      crypto.randomUUID(),
    );
    expect(result.mode).toBe("online");
  });
});
