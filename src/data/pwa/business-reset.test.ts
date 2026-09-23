import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import {
  getOutboxStore,
  resetOutboxStoreSingleton,
  resetOutboxSyncEngineSingleton,
} from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { clearLocalBusinessData } from "./business-reset";
import { RESET_CONFIRM_PHRASE, RESET_ENTITY_LABELS } from "@/components/account/ResetBusinessDataZone";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

async function seedBusiness(businessId: string, suffix: string) {
  const db = getLocalDb();
  const now = Date.now();
  await db.products.put({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa${suffix}`,
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
    images: [],
  });
  await db.customers.put({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb${suffix}`,
    businessId,
    code: null,
    name: "Rosa",
    phone: null,
    debt: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.sales.put({
    id: `cccccccc-cccc-4ccc-8ccc-cccccccccc${suffix}`,
    businessId,
    customerId: null,
    paymentKind: "paid",
    method: "Efectivo",
    saleTotal: 500,
    amountReceived: 500,
    credit: 0,
    requestId: `dddddddd-dddd-4ddd-8ddd-dddddddddd${suffix}`,
    note: null,
    occurredOn: "2026-09-20",
    createdAt: now,
    updatedAt: now,
  });
  await db.cacheMeta.put({
    id: `${businessId}::products`,
    businessId,
    resource: "products",
    cachedAt: now,
  });
  await db.prepState.put({
    id: `readiness::${businessId}`,
    businessId,
    status: "ready",
    prepVersion: 1,
    dbVersion: 5,
    completedAt: now,
    tasks: [],
  });
}

describe("business reset (local)", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    await __resetLocalDbForTests();
  });

  it("clears snapshots of the business too", async () => {
    const db = getLocalDb();
    await db.snapshots.put({
      id: `${BIZ}::dashboard`, businessId: BIZ, kind: "dashboard",
      payload: { ok: true }, capturedAt: 1,
    });
    await db.snapshots.put({
      id: `${OTHER}::dashboard`, businessId: OTHER, kind: "dashboard",
      payload: { ok: true }, capturedAt: 1,
    });
    await clearLocalBusinessData(BIZ);
    expect(await db.snapshots.where("businessId").equals(BIZ).count()).toBe(0);
    expect(await db.snapshots.where("businessId").equals(OTHER).count()).toBe(1);
  });

  it("clears every business row but keeps other tenants", async () => {
    await seedBusiness(BIZ, "a1");
    await seedBusiness(OTHER, "b2");
    await clearLocalBusinessData(BIZ);
    const db = getLocalDb();
    expect(await db.products.where("businessId").equals(BIZ).count()).toBe(0);
    expect(await db.customers.where("businessId").equals(BIZ).count()).toBe(0);
    expect(await db.sales.where("businessId").equals(BIZ).count()).toBe(0);
    expect(await db.cacheMeta.where("businessId").equals(BIZ).count()).toBe(0);
    expect(await db.prepState.where("businessId").equals(BIZ).count()).toBe(0);
    expect(await db.products.where("businessId").equals(OTHER).count()).toBe(1);
    expect(await db.cacheMeta.where("businessId").equals(OTHER).count()).toBe(1);
  });

  it("removes pending outbox ops so nothing resurrects after reconnect", async () => {
    await seedBusiness(BIZ, "a1");
    const outbox = getOutboxStore();
    await outbox.enqueue({
      operationId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      payload: {},
    });
    await clearLocalBusinessData(BIZ);
    expect(await getLocalDb().outbox.where("businessId").equals(BIZ).count()).toBe(0);
  });

  it("keeps portal ledger snapshots (separate M6.10 scope)", async () => {
    await getLocalDb().customerLedgers.put({
      customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ledger: {
        customer: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "DC-1", name: "R", debt: 0, createdAt: 1 },
        initials: [],
        sales: [],
        payments: [],
      },
      capturedAt: 1,
    });
    await clearLocalBusinessData(BIZ);
    expect(await getLocalDb().customerLedgers.count()).toBe(1);
  });

  it("invalidates only the wiped business portal snapshots", async () => {
    const db = getLocalDb();
    const snapshot = (id: string) => ({
      customerId: id,
      ledger: {
        customer: { id, code: "DC-1", name: "R", debt: 0, createdAt: 1 },
        initials: [],
        sales: [],
        payments: [],
      },
      capturedAt: 1,
    });
    const wipedA1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const wipedA2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const otherB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await db.customerLedgers.put(snapshot(wipedA1));
    await db.customerLedgers.put(snapshot(wipedA2));
    await db.customerLedgers.put(snapshot(otherB));
    await clearLocalBusinessData(BIZ, { customerIds: [wipedA1, wipedA2] });
    expect(await db.customerLedgers.get(wipedA1)).toBeUndefined();
    expect(await db.customerLedgers.get(wipedA2)).toBeUndefined();
    expect(await db.customerLedgers.get(otherB)).not.toBeUndefined();
  });

  it("removes pending media blobs so orphan uploads cannot resurrect", async () => {
    const db = getLocalDb();
    const now = Date.now();
    await db.pendingMedia.put({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      businessId: BIZ,
      productId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      fileName: "foto.jpg",
      mime: "image/jpeg",
      size: 100,
      blob: new Blob([new Uint8Array(100)], { type: "image/jpeg" }),
      position: null,
      isPrimary: false,
      altText: null,
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
    });
    await db.pendingMedia.put({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      businessId: OTHER,
      productId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      fileName: "otra.jpg",
      mime: "image/jpeg",
      size: 100,
      blob: new Blob([new Uint8Array(100)], { type: "image/jpeg" }),
      position: null,
      isPrimary: false,
      altText: null,
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: now,
    });
    await clearLocalBusinessData(BIZ);
    expect(await db.pendingMedia.where("businessId").equals(BIZ).count()).toBe(0);
    expect(await db.pendingMedia.where("businessId").equals(OTHER).count()).toBe(1);
  });

  it("wipes preparations of the business but keeps other tenants", async () => {
    const db = getLocalDb();
    const now = Date.now();
    await db.preparations.put({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      businessId: BIZ,
      sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sourceName: "Combo",
      targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      targetName: "Terminada",
      qty: 10,
      unitCost: 200,
      note: null,
      occurredOn: "2026-09-23",
      createdAt: now,
    });
    await db.preparations.put({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      businessId: OTHER,
      sourceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      sourceName: "Combo",
      targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      targetName: "Terminada",
      qty: 5,
      unitCost: 0,
      note: null,
      occurredOn: "2026-09-23",
      createdAt: now,
    });
    await clearLocalBusinessData(BIZ);
    expect(await db.preparations.where("businessId").equals(BIZ).count()).toBe(0);
    expect(await db.preparations.where("businessId").equals(OTHER).count()).toBe(1);
  });

  it("confirmation phrase and entity labels are exact", () => {
    expect(RESET_CONFIRM_PHRASE).toBe("ELIMINAR DATOS");
    expect(Object.keys(RESET_ENTITY_LABELS).sort()).toEqual(
      [
        "cashMoves", "cashSessions", "customerPayments", "customers",
        "expenses", "importIdMap", "initialDebts", "products",
        "productImages", "preparations", "saleLines", "saleReturnLines", "saleReturns", "sales",
        "settings", "stockMoves", "suppliers",
      ].sort(),
    );
  });
});
