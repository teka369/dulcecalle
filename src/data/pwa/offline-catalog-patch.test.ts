import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton, getLocalStore } from "@/data/local/store";
import { newEntityId } from "@/data/local/ids";
import {
  archiveProductWithOfflineFallback,
  patchCustomerWithOfflineFallback,
  patchProductWithOfflineFallback,
  patchSupplierWithOfflineFallback,
  syncPendingCustomers,
  syncPendingProducts,
  syncPendingSuppliers,
} from "./offline-catalog";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER_BIZ = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const SUPPLIER_ID = "44444444-4444-4444-8444-444444444444";
const PRODUCT_ID = "55555555-5555-4555-8555-555555555555";
const REQ = "66666666-6666-4666-8666-666666666666";

const api = {
  session: { businessId: BIZ },
  products: { patch: vi.fn(), archive: vi.fn() },
  customers: { create: vi.fn(), get: vi.fn(), patch: vi.fn() },
  suppliers: { create: vi.fn(), get: vi.fn(), patch: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/http/session", () => ({ getPwaAuthSession: () => api.session }));

async function seedCustomer(requestId?: string) {
  const now = Date.now();
  await getLocalDb().customers.put({
    id: CUSTOMER_ID,
    businessId: BIZ,
    code: "DC-0001",
    name: "Rosa",
    phone: null,
    debt: 0,
    archivedAt: null,
    ...(requestId ? { requestId } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

async function seedProduct() {
  const now = Date.now();
  await getLocalDb().products.put({
    id: PRODUCT_ID,
    businessId: BIZ,
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

describe("offline catalog patch/archive", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = BIZ;
  });

  it("rejects invalid patch input without touching Dexie", async () => {
    await expect(patchCustomerWithOfflineFallback(CUSTOMER_ID, { name: "   " }, REQ)).rejects.toThrow(
      "El nombre es obligatorio.",
    );
    await expect(
      patchProductWithOfflineFallback(PRODUCT_ID, { name: "X", price: -5 }, REQ),
    ).rejects.toThrow("El precio tiene que ser 0 o más.");
    expect(await getLocalDb().outbox.count()).toBe(0);
  });

  it("patches a customer offline with an outbox op", async () => {
    await seedCustomer();
    api.customers.patch.mockRejectedValue(new NetworkError("offline"));
    const result = await patchCustomerWithOfflineFallback(
      CUSTOMER_ID,
      { name: "Rosa Linda", phone: "300" },
      REQ,
    );
    expect(result.mode).toBe("offline");
    expect((await getLocalDb().customers.get(CUSTOMER_ID))?.name).toBe("Rosa Linda");
    const ops = await getOutboxStore().listPending(BIZ);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ entity: "customer", operation: "patch", requestId: REQ });
  });

  it("links a patch to the still-pending create operation", async () => {
    const createReq = "77777777-7777-4777-8777-777777777777";
    await seedCustomer(createReq);
    const outbox = getOutboxStore();
    const createOp = newEntityId();
    await outbox.enqueue({
      operationId: createOp,
      businessId: BIZ,
      entity: "customer",
      operation: "create",
      requestId: createReq,
      payload: { name: "Rosa" },
    });
    api.customers.patch.mockRejectedValue(new NetworkError("offline"));
    await patchCustomerWithOfflineFallback(CUSTOMER_ID, { name: "Rosa L." }, REQ);
    const patch = (await outbox.listPending(BIZ)).find((o) => o.operation === "patch");
    expect(patch?.dependsOn).toEqual([createOp]);
  });

  it("patches online without touching the outbox", async () => {
    await seedCustomer();
    api.customers.patch.mockResolvedValue({ id: CUSTOMER_ID });
    const result = await patchCustomerWithOfflineFallback(CUSTOMER_ID, { name: "Rosa L." }, REQ);
    expect(result.mode).toBe("online");
    expect(await getOutboxStore().listPending(BIZ)).toHaveLength(0);
    expect((await getLocalDb().customers.get(CUSTOMER_ID))?.name).toBe("Rosa L.");
  });

  it("does not fall back on HTTP errors", async () => {
    await seedCustomer();
    api.customers.patch.mockRejectedValue(new ApiError("VALIDATION", "Bad", 400));
    await expect(
      patchCustomerWithOfflineFallback(CUSTOMER_ID, { name: "X" }, REQ),
    ).rejects.toThrow("Bad");
    expect(await getOutboxStore().listPending(BIZ)).toHaveLength(0);
    expect((await getLocalDb().customers.get(CUSTOMER_ID))?.name).toBe("Rosa");
  });

  it("rejects patching another tenant's row", async () => {
    const now = Date.now();
    await getLocalDb().customers.put({
      id: CUSTOMER_ID,
      businessId: OTHER_BIZ,
      code: "DC-9",
      name: "Otro",
      phone: null,
      debt: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    api.customers.patch.mockRejectedValue(new NetworkError("offline"));
    await expect(
      patchCustomerWithOfflineFallback(CUSTOMER_ID, { name: "X" }, REQ),
    ).rejects.toThrow("no está disponible");
  });

  it("archives a product offline and syncs it", async () => {
    await seedProduct();
    api.products.archive.mockRejectedValue(new NetworkError("offline"));
    const result = await archiveProductWithOfflineFallback(PRODUCT_ID, REQ);
    expect(result.mode).toBe("offline");
    expect((await getLocalDb().products.get(PRODUCT_ID))?.archivedAt).toBeTruthy();
    api.products.archive.mockResolvedValue({ id: PRODUCT_ID });
    const flush = await syncPendingProducts(BIZ);
    expect(flush.synced).toBe(1);
    expect(api.products.archive).toHaveBeenCalledWith(PRODUCT_ID, REQ);
  });

  it("product patch never touches stock or cost", async () => {
    await seedProduct();
    api.products.patch.mockRejectedValue(new NetworkError("offline"));
    await patchProductWithOfflineFallback(PRODUCT_ID, { name: "Gom", price: 600 }, REQ);
    const row = await getLocalDb().products.get(PRODUCT_ID);
    expect(row?.stock).toBe(10);
    expect(row?.avgCost).toBe(100);
    expect(row?.price).toBe(600);
  });

  it("flushes customer and supplier patches with the stored requestId", async () => {
    await seedCustomer();
    const now = Date.now();
    await getLocalDb().suppliers.put({
      id: SUPPLIER_ID,
      businessId: BIZ,
      name: "Prov",
      phone: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
    api.customers.patch.mockRejectedValue(new NetworkError("offline"));
    api.suppliers.patch.mockRejectedValue(new NetworkError("offline"));
    await patchCustomerWithOfflineFallback(CUSTOMER_ID, { name: "R2" }, REQ);
    await patchSupplierWithOfflineFallback(SUPPLIER_ID, { notes: "n" }, REQ.replace(/6/g, "7"));
    api.customers.patch.mockResolvedValue({ id: CUSTOMER_ID });
    api.suppliers.patch.mockResolvedValue({ id: SUPPLIER_ID });
    const c = await syncPendingCustomers(BIZ);
    const s = await syncPendingSuppliers(BIZ);
    expect(c.synced).toBe(1);
    expect(s.synced).toBe(1);
    expect(api.customers.patch).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({ name: "R2" }),
      REQ,
    );
  });

  it("retrying a synced patch sends nothing twice", async () => {
    await seedCustomer();
    api.customers.patch.mockRejectedValue(new NetworkError("offline"));
    await patchCustomerWithOfflineFallback(CUSTOMER_ID, { name: "R2" }, REQ);
    api.customers.patch.mockClear();
    api.customers.patch.mockResolvedValue({ id: CUSTOMER_ID });
    await syncPendingCustomers(BIZ);
    await syncPendingCustomers(BIZ);
    expect(api.customers.patch).toHaveBeenCalledTimes(1);
  });

  it("patched rows stay visible in listings", async () => {
    await seedCustomer();
    api.customers.patch.mockRejectedValue(new NetworkError("offline"));
    await patchCustomerWithOfflineFallback(CUSTOMER_ID, { name: "R2" }, REQ);
    const rows = await getLocalStore().customers.list(BIZ);
    expect(rows.map((r) => r.id)).toContain(CUSTOMER_ID);
  });
});
