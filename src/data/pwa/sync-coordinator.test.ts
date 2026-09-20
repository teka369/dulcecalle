import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { newEntityId } from "@/data/local/ids";
import { newRequestId } from "@/domain/requestId";
import { syncAllPending } from "./sync-coordinator";

const businessId = "11111111-1111-4111-8111-111111111111";

const serverCustomerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const serverSupplierId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

async function seedMixedOutbox() {
  const outbox = getOutboxStore();
  const now = Date.now();

  await outbox.enqueue({
    operationId: newEntityId(),
    businessId,
    entity: "sale",
    operation: "create",
    requestId: newRequestId("seed"),
    payload: { lines: [], paymentKind: "paid", amountReceived: 0 },
    localCreatedAt: now,
  });
  await outbox.enqueue({
    operationId: newEntityId(),
    businessId,
    entity: "customerPayment",
    operation: "pay",
    requestId: newRequestId("seed"),
    payload: {
      customerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      amount: 1000,
      method: "Efectivo",
    },
    localCreatedAt: now + 1,
  });

  const customerRequestId = newRequestId("seed");
  const customerOp = newEntityId();
  await outbox.enqueue({
    operationId: customerOp,
    businessId,
    entity: "customer",
    operation: "create",
    requestId: customerRequestId,
    payload: { name: "Rosa" },
    localCreatedAt: now + 2,
  });
  await getLocalDb().customers.put({
    id: newEntityId(),
    businessId,
    code: null,
    name: "Rosa",
    phone: null,
    debt: 0,
    archivedAt: null,
    requestId: customerRequestId,
    createdAt: now,
    updatedAt: now,
  });

  const supplierRequestId = newRequestId("seed");
  await outbox.enqueue({
    operationId: newEntityId(),
    businessId,
    entity: "supplier",
    operation: "create",
    requestId: supplierRequestId,
    payload: { name: "Proveedor" },
    localCreatedAt: now + 3,
  });
  await getLocalDb().suppliers.put({
    id: newEntityId(),
    businessId,
    name: "Proveedor",
    requestId: supplierRequestId,
    phone: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
  });

  await outbox.enqueue({
    operationId: newEntityId(),
    businessId,
    entity: "cashMove",
    operation: "create",
    requestId: newRequestId("seed"),
    payload: { kind: "aporte", amount: 5000, method: "Efectivo" },
    localCreatedAt: now + 4,
  });
  await outbox.enqueue({
    operationId: newEntityId(),
    businessId,
    entity: "expense",
    operation: "create",
    requestId: newRequestId("seed"),
    payload: { amount: 2000, category: "Luz", method: "Efectivo" },
    localCreatedAt: now + 5,
  });
}

function mockAllSuccess() {
  api.sales.create.mockResolvedValue({ id: newEntityId() });
  api.customers.pay.mockResolvedValue({ id: newEntityId() });
  api.customers.create.mockResolvedValue({ id: serverCustomerId });
  api.customers.get.mockResolvedValue({
    id: serverCustomerId,
    code: "DC-0001",
    name: "Rosa",
    phone: null,
    debt: 0,
    archivedAt: null,
    createdAt: Date.now(),
  });
  api.suppliers.create.mockResolvedValue({ id: serverSupplierId });
  api.suppliers.get.mockResolvedValue({
    id: serverSupplierId,
    name: "Proveedor",
    phone: null,
    notes: null,
    createdAt: Date.now(),
  });
  api.cash.aporte.mockResolvedValue({ id: newEntityId() });
  api.cash.recordExpense.mockResolvedValue({ id: newEntityId() });
}

describe("D1 outbox coordinator", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    api.session.businessId = businessId;
    mockAllSuccess();
  });

  it("processes every pending type in a single cycle", async () => {
    await seedMixedOutbox();
    const result = await syncAllPending(businessId);
    expect(result.sales.synced).toBe(1);
    expect(result.payments.synced).toBe(1);
    expect(result.customers.synced).toBe(1);
    expect(result.suppliers.synced).toBe(1);
    expect(result.operations.synced).toBe(2);
    const leftovers = await getOutboxStore().listPending(businessId);
    expect(leftovers).toHaveLength(0);
  });

  it("concurrent triggers do not double-process operations", async () => {
    await seedMixedOutbox();
    const [first, second] = await Promise.all([
      syncAllPending(businessId),
      syncAllPending(businessId),
    ]);
    // The loser trigger shares the winner's result instead of resending.
    expect(first.sales.synced).toBe(1);
    expect(second.sales.synced).toBe(1);
    expect(api.sales.create).toHaveBeenCalledTimes(1);
    expect(api.customers.pay).toHaveBeenCalledTimes(1);
    expect(api.customers.create).toHaveBeenCalledTimes(1);
    expect(api.suppliers.create).toHaveBeenCalledTimes(1);
    expect(api.cash.aporte).toHaveBeenCalledTimes(1);
    expect(api.cash.recordExpense).toHaveBeenCalledTimes(1);
  });

  it("a permanently failing type does not starve the other types", async () => {
    await seedMixedOutbox();
    api.customers.pay.mockRejectedValue(new ApiError("VALIDATION", "Bad", 400));
    const result = await syncAllPending(businessId);
    expect(result.payments.failed).toBe(1);
    expect(result.sales.synced).toBe(1);
    expect(result.customers.synced).toBe(1);
    expect(result.suppliers.synced).toBe(1);
    expect(result.operations.synced).toBe(2);
  });

  it("already synced work is idempotent and is not resent", async () => {
    await seedMixedOutbox();
    await syncAllPending(businessId);
    vi.clearAllMocks();
    mockAllSuccess();
    const result = await syncAllPending(businessId);
    expect(result.sales.processed).toBe(0);
    expect(result.payments.processed).toBe(0);
    expect(result.customers.processed).toBe(0);
    expect(result.suppliers.processed).toBe(0);
    expect(result.operations.processed).toBe(0);
    expect(api.sales.create).not.toHaveBeenCalled();
    expect(api.customers.pay).not.toHaveBeenCalled();
    expect(api.customers.create).not.toHaveBeenCalled();
    expect(api.suppliers.create).not.toHaveBeenCalled();
    expect(api.cash.aporte).not.toHaveBeenCalled();
    expect(api.cash.recordExpense).not.toHaveBeenCalled();
  });
});
