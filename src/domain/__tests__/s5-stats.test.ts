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
    // Invertí = compra/surtir cash out only (≠ aporte ≠ gasto ≠ retiro)
    expect(snap.inverti).toBe(30_000);
    // Ganancia aprox: (10+5)*1000 − (10+5)*600 = 15000 − 9000 = 6000
    expect(snap.ganancia).toBe(6_000);
    // Valor inventario: 31 * 600
    expect(snap.valorInventario).toBe(18_600);

    // Never mix into one total
    expect(snap.ventas).not.toBe(snap.recibido);
    expect(snap.recibido).not.toBe(snap.porCobrar);
    expect(snap.gaste).not.toBe(snap.inverti);
    expect(snap.ganancia).not.toBe(snap.ventas);
    expect(snap.valorInventario).not.toBe(snap.ganancia);
  });

  it("Semana is last 7 local days inclusive", () => {
    const now = new Date(2026, 8, 17, 12, 0, 0).getTime(); // Sep 17 2026
    const r = rangeSemana(now);
    const spanDays = Math.round((r.endMs - r.startMs) / 86_400_000);
    expect(spanDays).toBe(7);
    expect(r.period).toBe("semana");
  });

  it("period filters isolate Hoy vs Mes", async () => {
    const productId = await productRepository.create({
      name: "Gomitas",
      category: "Dulce",
      price: 2000,
      avgCost: 800,
      stock: 10,
      lowStockAt: 2,
    });
    await cashRepository.openSession(0);
    await saleRepository.createSale({
      lines: [{ productId, qty: 1 }],
      paymentKind: "paid",
      amountReceived: 2000,
      method: "Nequi",
    });

    const hoy = await loadStats("hoy");
    expect(hoy.ventas).toBe(2000);
    expect(hoy.recibidoNequi).toBe(2000);
    expect(hoy.recibidoEfectivo).toBe(0);

    const mes = await loadStats("mes");
    expect(mes.ventas).toBe(2000);
  });

  it("persists stats across simulated reload (Dexie)", async () => {
    const productId = await productRepository.create({
      name: "Chicle",
      category: "Dulce",
      price: 500,
      avgCost: 200,
      stock: 20,
      lowStockAt: 3,
    });
    await cashRepository.openSession(0);
    await saleRepository.createSale({
      lines: [{ productId, qty: 2 }],
      paymentKind: "paid",
      amountReceived: 1000,
      method: "Efectivo",
    });

    const before = await loadStats("hoy");
    expect(before.ventas).toBe(1000);

    __reopenDbForTests();
    const after = await loadStats("hoy");
    expect(after.ventas).toBe(1000);
    expect(after.recibido).toBe(1000);
    expect(after.ganancia).toBe(600); // 1000 − 2*200
  });

  it("LOCKED copy has no Vendí/Recibí/Me deben and no Esperado in Stats", () => {
    expect(STATS_COPY.ventas).toBe("Ventas");
    expect(STATS_COPY.recibido).toBe("Recibido");
    expect(STATS_COPY.porCobrar).toBe("Por cobrar");
    expect(STATS_COPY.gaste).toBe("Gasté");
    expect(STATS_COPY.inverti).toBe("Invertí");
    expect(STATS_COPY.ganancia).toBe("Ganancia aprox");
    expect(STATS_COPY.irACaja).toBe("Ir a Caja");
    const blob = JSON.stringify(STATS_COPY);
    expect(blob).not.toContain("Vendí");
    expect(blob).not.toContain("Recibí");
    expect(blob).not.toContain("Me deben");
    expect(blob).not.toContain("Esperado");
    expect(blob).not.toContain("Contado");
    expect(blob).not.toContain("Diferencia");
    expect(blob).not.toContain("Top productos");
    expect(rangeForPeriod("hoy").period).toBe("hoy");
  });
});
