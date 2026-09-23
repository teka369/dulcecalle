import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, __reopenDbForTests } from "@/storage/db";
import { STATS_COPY, rangeForPeriod, rangeSemana } from "@/domain/stats";
import {
  cashRepository,
  customerRepository,
  inventoryRepository,
  metricCaja,
  metricFiadoOutstanding,
  metricRecibido,
  metricStockByProduct,
  metricVentas,
  productRepository,
  saleRepository,
} from "@/repositories";
import { loadStats } from "@/repositories/statsRepository";

describe("S5 stats — separate metrics & period ranges", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("keeps Day-1 Ventas/Recibido/Fiado/Caja/Stock separate", async () => {
    const productId = await productRepository.create({
      name: "Dulce prueba",
      category: "Test",
      price: 1000,
      avgCost: 0,
      stock: 0,
      lowStockAt: 5,
    });
    const customerId = await customerRepository.create({ name: "Cliente QA" });

    await cashRepository.purchaseStock({
      productId,
      qty: 50,
      totalCost: 30_000,
    });
    await cashRepository.ownerAporte(50_000);
    const sessionId = await cashRepository.openSession(0);

    await saleRepository.createSale({
      lines: [{ productId, qty: 10 }],
      paymentKind: "paid",
      amountReceived: 10_000,
      method: "Efectivo",
    });
    await saleRepository.createSale({
      lines: [{ productId, qty: 5 }],
      paymentKind: "credit",
      customerId,
      amountReceived: 0,
    });
    await inventoryRepository.applyMove({
      productId,
      delta: -1,
      reason: "me_lo_comi",
    });
    await inventoryRepository.applyMove({
      productId,
      delta: -2,
      reason: "regalar",
    });
    await inventoryRepository.applyMove({
      productId,
      delta: -1,
      reason: "perdido",
    });
    await cashRepository.recordExpense({
      amount: 5_000,
      category: "transporte",
    });
    await cashRepository.ownerRetiro(10_000);
    await customerRepository.recordPayment({
      customerId,
      amount: 2_000,
      method: "Efectivo",
    });
    const cajaBeforeClose = await metricCaja();
    await cashRepository.closeSession(sessionId, cajaBeforeClose);

    expect(await metricVentas()).toBe(15_000);
    expect(await metricRecibido()).toBe(12_000);
    expect(await metricFiadoOutstanding()).toBe(3_000);
    expect(await metricCaja()).toBe(17_000);
    expect(await metricStockByProduct(productId)).toBe(31);

    const snap = await loadStats("hoy");
    expect(snap.ventas).toBe(15_000);
    expect(snap.recibido).toBe(12_000);
    expect(snap.porCobrar).toBe(3_000);
    expect(snap.gaste).toBe(5_000);
    expect(snap.inverti).toBe(30_000);
    expect(snap.ganancia).toBe(6_000);
    expect(snap.valorInventario).toBe(18_600);

    expect(snap.ventas).not.toBe(snap.recibido);
    expect(snap.recibido).not.toBe(snap.porCobrar);
    expect(snap.gaste).not.toBe(snap.inverti);
    expect(snap.ganancia).not.toBe(snap.ventas);
    expect(snap.valorInventario).not.toBe(snap.ganancia);
  });

  it("Semana is last 7 local days inclusive", () => {
    const now = new Date(2026, 8, 17, 12, 0, 0).getTime();
    const r = rangeSemana(now);
    expect(r.period).toBe("semana");
  });

  it("valorInventario uses unit average for sellable and lot pool for combos", async () => {
    await productRepository.create({
      name: "Gomitas",
      category: "Test",
      price: 1000,
      avgCost: 50_000,
      stock: 2,
      lowStockAt: 5,
      sellable: true,
    });
    expect((await loadStats("hoy")).valorInventario).toBe(100_000);

    await __resetDbForTests();
    await productRepository.create({
      name: "Combo enchiladas",
      category: "Test",
      price: 0,
      avgCost: 100_000,
      stock: 2,
      lowStockAt: 5,
      sellable: false,
    });
    expect((await loadStats("hoy")).valorInventario).toBe(100_000);

    await __resetDbForTests();
    await productRepository.create({
      name: "Legacy sin flag",
      category: "Test",
      price: 1000,
      avgCost: 50_000,
      stock: 2,
      lowStockAt: 5,
    });
    expect((await loadStats("hoy")).valorInventario).toBe(100_000);
  });
});
