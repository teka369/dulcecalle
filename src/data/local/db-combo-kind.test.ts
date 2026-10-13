import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetLocalDbForTests, getLocalDb } from "./db";

const BIZ = "11111111-1111-4111-8111-111111111111";

/**
 * TICKET-A AC5. `kind` is an optional, NON-indexed product field, so Dexie
 * needs no new version: verno stays 9 (a bump would mark every device's
 * offline prep as stale, the same effect as raising PREP_VERSION). Pending
 * outbox items written before TICKET-A survive a reopen untouched, and old
 * rows without `kind` coexist with new combo rows.
 */
describe("TICKET-A Dexie compatibility (AC5)", () => {
  beforeEach(async () => {
    await __resetLocalDbForTests();
  });

  it("keeps verno, pending outbox and kind-less rows across a reopen", async () => {
    const db = getLocalDb();
    await db.open();
    expect(db.verno).toBe(9);
    const now = Date.now();
    const base = { businessId: BIZ, category: "General", price: 0, lowStockAt: 5, archivedAt: null, createdAt: now, updatedAt: now, images: [] };
    await db.products.put({ ...base, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Insumo viejo", avgCost: 5000, stock: 1, sellable: false } as never);
    await db.products.put({ ...base, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Combo", avgCost: 9000, stock: 1, sellable: false, kind: "combo" } as never);
    await db.outbox.put({
      operationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      businessId: BIZ,
      entity: "product",
      operation: "create",
      requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      payload: { name: "Pendiente", price: 0, sellable: false },
      status: "pending",
      attempts: 0,
      dependsOn: [],
      localCreatedAt: now,
    } as never);
    db.close();

    await db.open();
    expect(db.verno).toBe(9);
    expect(await db.outbox.count()).toBe(1);
    expect((await db.outbox.get("cccccccc-cccc-4ccc-8ccc-cccccccccccc"))?.status).toBe("pending");
    expect((await db.products.get("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"))?.kind).toBeUndefined();
    expect((await db.products.get("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"))?.kind).toBe("combo");
  });
});
