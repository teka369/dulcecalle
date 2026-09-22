import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCAL_DB_NAME,
  __resetLocalDbForTests,
  getLocalDb,
} from "./db";

const BIZ = "11111111-1111-4111-8111-111111111111";

/**
 * M6.10 §9 — Genuine v3 → v4 upgrade: open the database with the exact v3
 * schema, seed pre-existing rows, close it, then open the current
 * DulceCalleLocalDB (v4) and verify Dexie migrates without losing data.
 * Uses the project's fake-indexeddb harness; it exercises Dexie's real
 * version-upgrade path, not a simulation.
 */
async function openAsV3(): Promise<Dexie> {
  const old = new Dexie(LOCAL_DB_NAME);
  old.version(1).stores({
    products: "id, businessId, [businessId+id], [businessId+updatedAt]",
    customers: "id, businessId, [businessId+id], [businessId+updatedAt]",
    suppliers: "id, businessId, [businessId+id], [businessId+updatedAt]",
    sales: "id, businessId, [businessId+id], [businessId+updatedAt], requestId",
    saleLines: "id, businessId, saleId, [businessId+saleId]",
    saleReturns: "id, businessId, saleId, requestId, [businessId+saleId]",
    saleReturnLines: "id, businessId, returnId, [businessId+returnId]",
    stockMoves: "id, businessId, productId, [businessId+productId]",
    cashSessions: "id, businessId, localDate, [businessId+localDate]",
    cashMoves: "id, businessId, sessionId, [businessId+id]",
    expenses: "id, businessId, [businessId+id]",
    customerPayments: "id, businessId, customerId, requestId, [businessId+customerId]",
    initialDebts: "id, businessId, customerId, requestId, [businessId+customerId]",
    outbox:
      "operationId, businessId, status, requestId, localCreatedAt, [businessId+status], &[businessId+requestId], [businessId+localCreatedAt]",
  });
  old.version(2).stores({
    cacheMeta: "id, businessId, resource, [businessId+resource]",
  });
  old.version(3).stores({
    cashSessions:
      "id, businessId, localDate, requestId, [businessId+localDate], [businessId+requestId]",
  });
  await old.open();
  return old;
}

describe("Dexie v3 → current migration (M6.10/M6.12/M6.13)", () => {
  beforeEach(async () => {
    await __resetLocalDbForTests();
  });

  it("preserves v3 data and adds customerLedgers + prepState + snapshots", async () => {
    const old = await openAsV3();
    const now = Date.now();
    await old.table("products").put({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
    await old.table("outbox").put({
      operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      businessId: BIZ,
      entity: "sale",
      operation: "create",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      payload: {},
      dependsOn: [],
      localCreatedAt: now,
      status: "pending",
      remoteId: null,
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
    });
    await old.table("cashSessions").put({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      businessId: BIZ,
      localDate: "2026-09-20",
      openedAt: now,
      closedAt: null,
      openingFloat: 5000,
      closingCount: null,
      expectedEfectivo: null,
      expectedNequi: null,
      difference: null,
      note: null,
      createdAt: now,
      updatedAt: now,
      requestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });
    old.close();

    const db = getLocalDb();
    expect(db.verno).toBe(6);
    expect(await db.snapshots.count()).toBe(0);
    expect(
      (await db.products.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))?.stock,
    ).toBe(10);
    expect(
      (await db.outbox.get("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))?.status,
    ).toBe("pending");
    expect(
      (await db.cashSessions.get("dddddddd-dddd-4ddd-8ddd-dddddddddddd"))
        ?.openingFloat,
    ).toBe(5000);

    // New tables exist, start empty, and are writable.
    expect(await db.prepState.count()).toBe(0);
    await db.prepState.put({
      id: "readiness::" + BIZ,
      businessId: BIZ,
      status: "ready",
      prepVersion: 1,
      dbVersion: 5,
      completedAt: now,
      tasks: [],
    });
    expect((await db.prepState.get("readiness::" + BIZ))?.status).toBe("ready");
    expect(await db.customerLedgers.count()).toBe(0);
    await db.customerLedgers.put({
      customerId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      ledger: {
        customer: {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          code: "DC-0001",
          name: "Rosa",
          debt: 0,
          createdAt: 1,
        },
        initials: [],
        sales: [],
        payments: [],
      },
      capturedAt: now,
    });
    expect(
      (await db.customerLedgers.get("ffffffff-ffff-4fff-8fff-ffffffffffff"))?.capturedAt,
    ).toBe(now);
  });
});
