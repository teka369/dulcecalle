import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "@/storage/db";
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

/**
 * QA Day-1 domain asserts — each metric SEPARATE (never mix).
 *
 * Cash path: +50000 aporte −30000 compra +10000 venta pagada +2000 abono
 *            −5000 transporte −10000 retiro = 17000
 * Stock: 50−10−5−1−2−1 = 31
 *
 * Ventas = 15000 | Recibido = 12000 | Fiado = 3000 | Caja = 17000 | Stock = 31
 */
describe("Day-1 domain metrics (separate asserts)", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("asserts Ventas, Recibido, Fiado, Caja, Stock independently", async () => {
    const productId = await productRepository.create({
      name: "Dulce prueba",
      category: "Test",
      price: 1000,
      avgCost: 0,
      stock: 0,
      lowStockAt: 5,
    });

    const customerId = await customerRepository.create({ name: "Cliente QA" });

    // 1. Purchase 50 units total $30_000 → unit cost 600; sell price 1000
    await cashRepository.purchaseStock({
      productId,
      qty: 50,
      totalCost: 30_000,
    });
    const afterPurchase = await productRepository.getById(productId);
    expect(afterPurchase?.avgCost).toBe(600);
    expect(afterPurchase?.price).toBe(1000);
    expect(afterPurchase?.stock).toBe(50);

    // 2. Owner aporte $50_000
    await cashRepository.ownerAporte(50_000);

    const sessionId = await cashRepository.openSession(0);

    // 3. Sale paid qty 10 → saleTotal 10000, amountReceived 10000
    await saleRepository.createSale({
      lines: [{ productId, qty: 10 }],
      paymentKind: "paid",
      amountReceived: 10_000,
      method: "Efectivo",
    });

    // 4. Sale fiado qty 5 → saleTotal 5000, credit 5000
    await saleRepository.createSale({
      lines: [{ productId, qty: 5 }],
      paymentKind: "credit",
      customerId,
      amountReceived: 0,
    });

    // 5. Consume (me lo comí) 1
    await inventoryRepository.applyMove({
      productId,
      delta: -1,
      reason: "me_lo_comi",
    });
    // 6. Gift (regalar) 2
    await inventoryRepository.applyMove({
      productId,
      delta: -2,
      reason: "regalar",
    });
    // 7. Loss (perdido) 1
    await inventoryRepository.applyMove({
      productId,
      delta: -1,
      reason: "perdido",
    });

    // 8. Expense transporte $5_000
    await cashRepository.recordExpense({
      amount: 5_000,
      category: "transporte",
    });

    // 9. Owner retiro $10_000
    await cashRepository.ownerRetiro(10_000);

    // 10. Customer abono $2_000 → fiado 5000−2000 = 3000
    await customerRepository.recordPayment({
      customerId,
      amount: 2_000,
      method: "Efectivo",
    });

    // 11. Cash session close
    const cajaBeforeClose = await metricCaja();
    await cashRepository.closeSession(sessionId, cajaBeforeClose);

    // ——— SEPARATE ASSERTS (do not blend) ———
    expect(await metricVentas()).toBe(15_000);
    expect(await metricRecibido()).toBe(12_000);
    expect(await metricFiadoOutstanding()).toBe(3_000);
    expect(await metricCaja()).toBe(17_000);
    expect(await metricStockByProduct(productId)).toBe(31);
  });
});
