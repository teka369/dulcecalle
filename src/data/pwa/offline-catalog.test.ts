import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import {
  __resetLocalDbForTests,
  getLocalDb,
} from "@/data/local/db";
import { resetLocalStoreSingleton } from "@/data/local/store";

const businessId = "11111111-1111-4111-8111-111111111111";
const otherBusinessId = "22222222-2222-4222-8222-222222222222";

const api = {
  session: { businessId },
  customers: {
    create: vi.fn(),
    get: vi.fn(),
  },
  suppliers: {
    create: vi.fn(),
    get: vi.fn(),
  },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));

import {
  createCustomerWithOfflineFallback,
  createSupplierWithOfflineFallback,
  syncPendingCustomers,
  syncPendingSuppliers,
  validateCatalogName,
} from "./offline-catalog";

describe("M6.7 offline catalog creation", () => {
  beforeEach(async () => {
    await __resetLocalDbForTests();
    resetLocalStoreSingleton();
    vi.clearAllMocks();
    api.session.businessId = businessId;
  });

  it("validates and normalizes names", () => {
    expect(validateCatalogName("  Ana  ")).toBe("Ana");
    expect(() => validateCatalogName("   ")).toThrow("El nombre es obligatorio.");
  });

  it("creates a customer locally on NetworkError with code null and an outbox item", async () => {
    api.customers.create.mockRejectedValue(new NetworkError("offline"));

    const result = await createCustomerWithOfflineFallback(
      { name: "  Ana  ", phone: " 300 " },
      "33333333-3333-4333-8333-333333333333",
    );

    expect(result.mode).toBe("offline");
    const db = getLocalDb();
    const row = await db.customers.get(result.customerId);
    expect(row).toMatchObject({
      id: result.customerId,
      businessId,
      code: null,
      name: "Ana",
      phone: "300",
      debt: 0,
      requestId: "33333333-3333-4333-8333-333333333333",
    });
    const outbox = await db.outbox.where("businessId").equals(businessId).toArray();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entity: "customer",
      operation: "create",
      requestId: "33333333-3333-4333-8333-333333333333",
      status: "pending",
      dependsOn: [],
    });
  });

  it("creates a supplier locally and keeps it tenant-scoped", async () => {
    api.suppliers.create.mockRejectedValue(new NetworkError("offline"));

    const result = await createSupplierWithOfflineFallback(
      { name: "  Proveedor X ", phone: "", notes: "  " },
      "44444444-4444-4444-8444-444444444444",
    );

    expect(result.mode).toBe("offline");
    const db = getLocalDb();
    const row = await db.suppliers.get(result.supplierId);
    expect(row).toMatchObject({
      id: result.supplierId,
      businessId,
      name: "Proveedor X",
      phone: null,
      notes: null,
      requestId: "44444444-4444-4444-8444-444444444444",
    });
    expect(await db.suppliers.where("businessId").equals(otherBusinessId).count()).toBe(0);
  });

  it("does not fallback for HTTP errors", async () => {
    api.customers.create.mockRejectedValue(Object.assign(new Error("bad request"), { status: 400 }));

    await expect(
      createCustomerWithOfflineFallback({ name: "Ana" }, "55555555-5555-4555-8555-555555555555"),
    ).rejects.toThrow("bad request");

    expect(await getLocalDb().customers.count()).toBe(0);
    expect(await getLocalDb().outbox.count()).toBe(0);
  });

  it("preserves the same requestId on retry of the same local intention", async () => {
    api.customers.create.mockRejectedValue(new NetworkError("offline"));
    const requestId = "66666666-6666-4666-8666-666666666666";

    const first = await createCustomerWithOfflineFallback({ name: "Ana" }, requestId);
    const second = await createCustomerWithOfflineFallback({ name: "Ana" }, requestId);

    expect(second.mode).toBe("offline");
    expect(second.customerId).toBe(first.customerId);
    expect(await getLocalDb().outbox.count()).toBe(1);
  });

  it("syncs a customer with the same requestId and reconciles the server code/id", async () => {
    api.customers.create.mockRejectedValueOnce(new NetworkError("offline"));
    const requestId = "77777777-7777-4777-8777-777777777777";
    const local = await createCustomerWithOfflineFallback({ name: "Ana" }, requestId);
    const remote = {
      id: "88888888-8888-4888-8888-888888888888",
      code: "DC-0042",
      name: "Ana",
      phone: null,
      debt: 0,
      archivedAt: null,
      createdAt: Date.now(),
    };
    api.customers.create.mockResolvedValue(remote);
    api.customers.get.mockResolvedValue(remote);

    await syncPendingCustomers(businessId);

    expect(api.customers.create).toHaveBeenLastCalledWith({ name: "Ana" }, requestId);
    expect(await getLocalDb().customers.get(local.customerId)).toBeUndefined();
    expect(await getLocalDb().customers.get(remote.id)).toMatchObject({
      id: remote.id,
      code: "DC-0042",
      businessId,
    });
  });

  it("syncs a supplier and reconciles the server id", async () => {
    api.suppliers.create.mockRejectedValueOnce(new NetworkError("offline"));
    const requestId = "99999999-9999-4999-8999-999999999999";
    const local = await createSupplierWithOfflineFallback(
      { name: "Proveedor X", notes: "nota" },
      requestId,
    );
    const remote = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Proveedor X",
      phone: null,
      notes: "nota",
      createdAt: Date.now(),
    };
    api.suppliers.create.mockResolvedValue(remote);
    api.suppliers.get.mockResolvedValue(remote);

    await syncPendingSuppliers(businessId);

    expect(api.suppliers.create).toHaveBeenLastCalledWith(
      { name: "Proveedor X", notes: "nota" },
      requestId,
    );
    expect(await getLocalDb().suppliers.get(local.supplierId)).toBeUndefined();
    expect(await getLocalDb().suppliers.get(remote.id)).toMatchObject({
      id: remote.id,
      businessId,
    });
  });

  it("keeps another tenant invisible to local reconciliation", async () => {
    api.customers.create.mockRejectedValue(new NetworkError("offline"));
    const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const local = await createCustomerWithOfflineFallback({ name: "Ana" }, requestId);

    const db = getLocalDb();
    await db.customers.put({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      businessId: otherBusinessId,
      code: "DC-9999",
      name: "Otro",
      phone: null,
      debt: 0,
      archivedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const rows = await db.customers.where("businessId").equals(otherBusinessId).toArray();
    expect(rows.map((row) => row.id)).not.toContain(local.customerId);
  });
});
