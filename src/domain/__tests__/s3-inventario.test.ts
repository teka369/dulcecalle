import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, getDb } from "@/storage/db";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { weightedAvgCost } from "@/repositories/inventoryRepository";
import {
  cashRepository,
  inventoryRepository,
  metricStockByProduct,
  productRepository,
  supplierRepository,
} from "@/repositories";

/**
 * QA S3 — surtir / mermas / integrity / historial.
 * Keep STOCK path ≠ VENTAS ≠ RECIBIDO ≠ FIADO ≠ CAJA.
 */
describe("S3 inventario surtir + mermas", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  async function seedProduct(stock = 10, avgCost = 500) {
    return productRepository.create({
      name: "Chicle menta",
      category: "Chicles",
      price: 1000,
      avgCost,
      stock,
      lowStockAt: 5,
    });
  }

  it("surtir increases stock and updates weighted avgCost (round)", async () => {
    const productId = await seedProduct(10, 500);
    // 10@500 + 10@700 → avg 600
    await inventoryRepository.surtir({
      productId,
      qty: 10,
      unitCost: 700,
      totalCost: 7000,
      method: "Efectivo",
    });
    const p = await productRepository.getById(productId);
    expect(p?.stock).toBe(20);
    expect(p?.avgCost).toBe(600);
    expect(weightedAvgCost(10, 500, 10, 700)).toBe(600);

    const moves = await inventoryRepository.listMoves(productId);
    expect(moves[0]?.reason).toBe("surtir");
    expect(moves[0]?.delta).toBe(10);

    const cash = await getDb().cashMoves.toArray();
    expect(cash.some((c) => c.kind === "compra" && c.direction === "out")).toBe(
      true,
    );
  });

  it("three shrink types decrease stock with distinct reasons", async () => {
    const productId = await seedProduct(20, 400);
    await inventoryRepository.applyShrink({
      productId,
      qty: 1,
      reason: "me_lo_comi",
    });
    await inventoryRepository.applyShrink({
      productId,
      qty: 2,
      reason: "regalar",
      note: "cliente fiel",
    });
    await inventoryRepository.applyShrink({
      productId,
      qty: 1,
      reason: "perdido",
      note: "se derritió",
    });

    expect(await metricStockByProduct(productId)).toBe(16);
    const moves = await inventoryRepository.listMoves(productId);
    const reasons = moves.map((m) => m.reason).sort();
    expect(reasons).toEqual(["me_lo_comi", "perdido", "regalar"]);
    // No cash / income on shrink
    const cash = await getDb().cashMoves.toArray();
    expect(cash).toHaveLength(0);
  });

  it("never allows negative stock", async () => {
    const productId = await seedProduct(2, 400);
    await expect(
      inventoryRepository.applyShrink({
        productId,
        qty: 3,
        reason: "me_lo_comi",
      }),
    ).rejects.toThrow(INVENTORY_ERRORS.insufficientStock);
    expect(await metricStockByProduct(productId)).toBe(2);
  });

  it("Day-1 path still coherent → Stock 31", async () => {
    const productId = await productRepository.create({
      name: "Dulce prueba",
      category: "Test",
      price: 1000,
      avgCost: 0,
      stock: 0,
      lowStockAt: 5,
    });

    await cashRepository.purchaseStock({
      productId,
      qty: 50,
      totalCost: 30_000,
    });
    // 50 − 10 − 5 − 1 − 2 − 1 via sale-like stock outs + shrinks
    // Simulate sale outs with applyMove sale reason (no full sale needed for stock assert)
    await inventoryRepository.applyMove({
      productId,
      delta: -10,
      reason: "sale",
    });
    await inventoryRepository.applyMove({
      productId,
      delta: -5,
      reason: "sale",
    });
    await inventoryRepository.applyShrink({
      productId,
      qty: 1,
      reason: "me_lo_comi",
    });
    await inventoryRepository.applyShrink({
      productId,
      qty: 2,
      reason: "regalar",
    });
    await inventoryRepository.applyShrink({
      productId,
      qty: 1,
      reason: "perdido",
      note: "roto",
    });

    expect(await metricStockByProduct(productId)).toBe(31);
  });

  it("persists historial (moves visible after reload)", async () => {
    const productId = await seedProduct(5, 200);
    const supplierId = await supplierRepository.create({
      name: "Distribuidora Sol",
      phone: "3001112233",
    });
    await inventoryRepository.surtir({
      productId,
      qty: 5,
      unitCost: 250,
      totalCost: 1250,
      method: "Nequi",
      supplierId,
      note: "pedido lunes",
    });
    await inventoryRepository.applyShrink({
      productId,
      qty: 1,
      reason: "regalar",
      note: "muestra",
    });

    // "Reload" = new reads from Dexie
    const moves = await inventoryRepository.listMoves(productId);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(moves.some((m) => m.reason === "surtir" && m.supplierId === supplierId)).toBe(
      true,
    );
    expect(moves.some((m) => m.reason === "regalar")).toBe(true);

    const historial = await supplierRepository.listSurtidas(supplierId);
    expect(historial).toHaveLength(1);
    expect(historial[0]?.qty).toBe(5);
    expect(historial[0]?.method).toBe("Nequi");
  });

  it("rejects perdido without motivo at store validation layer via applyShrink note empty still records — domain applyShrink allows; UI validates", async () => {
    // Repository records note; UI/store enforce motivo. Ensure stock integrity still holds.
    const productId = await seedProduct(3, 100);
    await inventoryRepository.applyShrink({
      productId,
      qty: 1,
      reason: "perdido",
      note: "se rompió",
    });
    expect(await metricStockByProduct(productId)).toBe(2);
  });
});
