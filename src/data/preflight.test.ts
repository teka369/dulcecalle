import { describe, expect, it } from "vitest";
import { analyzePreflight, rejectNonRealSource } from "./preflight";
import type { DexieSnapshot } from "@/storage/snapshot";
import { checksumTables, SNAPSHOT_TABLES } from "@/storage/snapshot";

function emptyTables(): DexieSnapshot["tables"] {
  return Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, []])) as unknown as DexieSnapshot["tables"];
}

describe("Fase 6.9 preflight", () => {
  it("refuses TEST_FIXTURE as if it were real phone data", () => {
    expect(rejectNonRealSource({ source: "TEST_FIXTURE", notProduction: true })).toMatch(
      /not DEXIE_REAL/,
    );
    const fake = {
      snapshotId: "x",
      createdAt: "",
      source: "TEST_FIXTURE",
      claim: "DEVICE_COPY",
      schemaVersion: 8,
      dbName: "dulcecalle",
      recordCounts: Object.fromEntries(SNAPSHOT_TABLES.map((t) => [t, 0])),
      checksum: "",
      tables: emptyTables(),
    } as unknown as DexieSnapshot;
    const report = analyzePreflight(fake);
    expect(report.sourceRejected).toMatch(/TEST_FIXTURE/);
    expect(report.importerBlockers.length).toBeGreaterThan(0);
  });

  it("reconciles debt, $45k initial, snapshots, orphans, demo UNKNOWN mix", async () => {
    const tables = emptyTables();
    tables.products = [
      {
        id: 1,
        name: "Galleta",
        category: "G",
        price: 1000,
        avgCost: 400,
        stock: 2,
        lowStockAt: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 2,
        name: "Chicle menta",
        category: "C",
        price: 500,
        avgCost: 200,
        stock: 7,
        lowStockAt: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    tables.customers = [
      { id: 1, name: "Vecina", debt: 45_200, createdAt: 1, updatedAt: 1 },
      { id: 2, name: "Doña Rosa", debt: 0, createdAt: 1, updatedAt: 1 },
    ];
    tables.initialDebts = [
      { id: 1, customerId: 1, amount: 45_200, createdAt: 1, requestId: "inicial-1" },
    ];
    tables.sales = [
      {
        id: 1,
        createdAt: 1,
        customerId: null,
        paymentKind: "paid",
        saleTotal: 1000,
        amountReceived: 1000,
        credit: 0,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    ];
    tables.saleLines = [
      {
        id: 1,
        saleId: 1,
        productId: 1,
        productName: "Galleta",
        qty: 1,
        unitPrice: 800,
        unitCost: 300,
        lineTotal: 800,
      },
    ];
    tables.stockMoves = [
      { id: 1, productId: 1, delta: 3, reason: "inicial", unitCost: 300, createdAt: 1 },
      { id: 2, productId: 1, delta: -1, reason: "sale", unitCost: 300, createdAt: 1, refType: "sale", refId: 1 },
    ];
    tables.settings = [{ key: "demoLoaded", value: "1" }];

    const checksum = await checksumTables(tables);
    const snap: DexieSnapshot = {
      snapshotId: "t",
      createdAt: "2026-09-18T00:00:00.000Z",
      source: "DEXIE",
      claim: "DEVICE_COPY",
      schemaVersion: 8,
      dbName: "dulcecalle",
      recordCounts: Object.fromEntries(
        SNAPSHOT_TABLES.map((t) => [t, tables[t].length]),
      ) as DexieSnapshot["recordCounts"],
      checksum,
      tables,
    };

    const report = analyzePreflight(snap);
    expect(report.sourceRejected).toBeUndefined();
    expect(report.initialDebtSum).toBe(45_200);
    expect(report.initialDebtReference).toBe("MATCH");
    expect(report.debt.mismatches).toEqual([]);
    expect(report.sales.bad[0]).toMatch(/total 1000 vs lines 800/);
    expect(report.historicalSnapshots).toBe(1);
    expect(report.stock.legacyWithoutInicial).toContain("Chicle menta");
    expect(report.demo.label).toBe("UNKNOWN");
    expect(report.orphans).toEqual([]);
    expect(report.requestIds.legacy).toBe(1);
    expect(report.requestIds.valid).toBe(1);
  });
});
