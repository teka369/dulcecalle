import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, getDb } from "./db";
import { customerRepository } from "@/repositories/customerRepository";
import { productRepository } from "@/repositories/productRepository";
import {
  SNAPSHOT_TABLES,
  checksumTables,
  exportDexieSnapshot,
  verifySnapshotUnchanged,
} from "./snapshot";

describe("read-only Dexie snapshot", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("exports every table without mutating counts, ids, stock, or debt", async () => {
    const productId = await productRepository.create({
      name: "Copia",
      category: "Test",
      price: 500,
      avgCost: 200,
      stock: 3,
      lowStockAt: 1,
    });
    const customerId = await customerRepository.create({ name: "Vecina" });
    await customerRepository.recordInitialDebt({
      customerId,
      amount: 12_000,
      requestId: "preflight-debt",
    });

    const db = getDb();
    const before = {
      products: await db.products.count(),
      customers: await db.customers.count(),
      sales: await db.sales.count(),
      initialDebts: await db.initialDebts.count(),
      product: await db.products.get(productId),
      customer: await db.customers.get(customerId),
    };

    const a = await exportDexieSnapshot();
    expect(a.source).toBe("DEXIE");
    expect(a.source).not.toBe("TEST_FIXTURE");
    expect(a.schemaVersion).toBe(8);
    expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
    for (const table of SNAPSHOT_TABLES) {
      expect(Array.isArray(a.tables[table])).toBe(true);
    }

    const afterProduct = await db.products.get(productId);
    const afterCustomer = await db.customers.get(customerId);
    expect(await db.products.count()).toBe(before.products);
    expect(await db.customers.count()).toBe(before.customers);
    expect(await db.sales.count()).toBe(before.sales);
    expect(await db.initialDebts.count()).toBe(before.initialDebts);
    expect(afterProduct?.id).toBe(productId);
    expect(afterProduct?.stock).toBe(3);
    expect(afterProduct?.updatedAt).toBe(before.product?.updatedAt);
    expect(afterCustomer?.id).toBe(customerId);
    expect(afterCustomer?.debt).toBe(12_000);
    expect(afterCustomer?.updatedAt).toBe(before.customer?.updatedAt);

    const b = await exportDexieSnapshot();
    const check = await verifySnapshotUnchanged(a, b);
    expect(check.ok).toBe(true);
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).toBe(await checksumTables(a.tables));
    expect(a.tables.products.map((p) => (p as { id: number }).id)).toEqual(
      b.tables.products.map((p) => (p as { id: number }).id),
    );
  });
});
