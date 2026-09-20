import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetLocalDbForTests,
  getLocalDb,
} from "@/data/local/db";
import { getLocalStore, resetLocalStoreSingleton } from "@/data/local/store";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
} from "@/data/local/outbox";
import { CatalogReadCache } from "./read-cache";

const BIZ = "11111111-1111-4111-8111-111111111111";
const SERVER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQ_PENDING = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REQ_OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function serverCustomer() {
  return {
    id: SERVER_ID,
    code: "DC-0001",
    name: "Servidor",
    phone: null,
    debt: 0,
    archivedAt: null,
    createdAt: 1000,
  };
}

function localPendingCustomer() {
  return {
    id: LOCAL_ID,
    businessId: BIZ,
    code: null,
    name: "Local pendiente",
    phone: null,
    debt: 0,
    archivedAt: null,
    requestId: REQ_PENDING,
    createdAt: 2000,
    updatedAt: 2000,
  };
}

describe("D2 read-cache preserves pending rows", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  function cache() {
    return new CatalogReadCache(getLocalStore(), getLocalDb());
  }

  it("keeps a pending created customer across an online refresh", async () => {
    await getLocalDb().customers.put(localPendingCustomer());
    await getOutboxStore().enqueue({
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      businessId: BIZ,
      entity: "customer",
      operation: "create",
      requestId: REQ_PENDING,
      payload: { name: "Local pendiente" },
    });

    const result = await cache().listCustomers(BIZ, async () => [
      serverCustomer(),
    ]);
    expect(result.source).toBe("server");
    expect(result.data).toHaveLength(1);

    const rows = await getLocalStore().customers.list(BIZ);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [LOCAL_ID, SERVER_ID].sort(),
    );
  });

  it("replaces everything when nothing is pending", async () => {
    await getLocalDb().customers.put({ ...localPendingCustomer(), requestId: undefined });
    const result = await cache().listCustomers(BIZ, async () => [
      serverCustomer(),
    ]);
    expect(result.source).toBe("server");
    const rows = await getLocalStore().customers.list(BIZ);
    expect(rows.map((r) => r.id)).toEqual([SERVER_ID]);
  });

  it("keeps pending rows while updating synced ones", async () => {
    await getLocalDb().customers.put(localPendingCustomer());
    await getLocalDb().customers.put({
      id: SERVER_ID,
      businessId: BIZ,
      code: "DC-0001",
      name: "Viejo",
      phone: null,
      debt: 0,
      archivedAt: null,
      createdAt: 1000,
      updatedAt: 1000,
    });
    await getOutboxStore().enqueue({
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      businessId: BIZ,
      entity: "customer",
      operation: "create",
      requestId: REQ_PENDING,
      payload: { name: "Local pendiente" },
    });

    await cache().listCustomers(BIZ, async () => [serverCustomer()]);
    const rows = await getLocalStore().customers.list(BIZ);
    expect(rows.map((r) => r.id).sort()).toEqual(
      [LOCAL_ID, SERVER_ID].sort(),
    );
    expect(rows.find((r) => r.id === SERVER_ID)?.name).toBe("Servidor");
    expect(rows.find((r) => r.id === LOCAL_ID)?.name).toBe("Local pendiente");
  });

  it("preserves rows with failed or in-flight operations too", async () => {
    await getLocalDb().customers.put(localPendingCustomer());
    const outbox = getOutboxStore();
    const op = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await outbox.enqueue({
      operationId: op,
      businessId: BIZ,
      entity: "customer",
      operation: "create",
      requestId: REQ_PENDING,
      payload: { name: "Local pendiente" },
    });
    await outbox.markInFlight(BIZ, op);
    await cache().listCustomers(BIZ, async () => [serverCustomer()]);
    expect(
      (await getLocalStore().customers.list(BIZ)).map((r) => r.id).sort(),
    ).toEqual([LOCAL_ID, SERVER_ID].sort());

    await outbox.markFailed(BIZ, op, "boom");
    await cache().listCustomers(BIZ, async () => [serverCustomer()]);
    expect(
      (await getLocalStore().customers.list(BIZ)).map((r) => r.id).sort(),
    ).toEqual([LOCAL_ID, SERVER_ID].sort());
  });

  it("does not duplicate rows after repeated refreshes", async () => {
    await getLocalDb().customers.put(localPendingCustomer());
    await getOutboxStore().enqueue({
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      businessId: BIZ,
      entity: "customer",
      operation: "create",
      requestId: REQ_PENDING,
      payload: { name: "Local pendiente" },
    });
    const c = cache();
    await c.listCustomers(BIZ, async () => [serverCustomer()]);
    await c.listCustomers(BIZ, async () => [serverCustomer()]);
    const rows = await getLocalStore().customers.list(BIZ);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("applies the same rule to suppliers", async () => {
    const now = 2000;
    await getLocalDb().suppliers.put({
      id: LOCAL_ID,
      businessId: BIZ,
      name: "Proveedor pendiente",
      requestId: REQ_OTHER,
      phone: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    });
    await getOutboxStore().enqueue({
      operationId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      businessId: BIZ,
      entity: "supplier",
      operation: "create",
      requestId: REQ_OTHER,
      payload: { name: "Proveedor pendiente" },
    });
    const result = await cache().listSuppliers(BIZ, async () => []);
    expect(result.source).toBe("server");
    expect(result.data).toEqual([]);
    const rows = await getLocalStore().suppliers.list(BIZ);
    expect(rows.map((r) => r.id)).toEqual([LOCAL_ID]);
  });
});
