import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, __reopenDbForTests, getDb } from "@/storage/db";
import { CASH_ERRORS } from "@/domain/cash";
import { loadStats } from "@/repositories/statsRepository";
import {
  cashRepository,
  customerRepository,
  inventoryRepository,
  metricCaja,
  metricFiadoOutstanding,
  metricRecibido,
  metricVentas,
  productRepository,
  saleRepository,
} from "@/repositories";

/**
 * Fase 2 — un día real: caja, surtir, ventas, fiado, abono, gasto, retiro,
 * merma, cierre, persistencia e idempotencia.
 */
describe("F2 día real", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("walks a full day without mixing ledgers", async () => {
    const chicleId = await productRepository.create({
      name: "Chicle",
      category: "Chicles",
      price: 1000,
      avgCost: 400,
      stock: 10,
      lowStockAt: 2,
    });
    const gomitaId = await productRepository.create({
      name: "Gomita",
      category: "Gomitas",
      price: 1500,
      avgCost: 600,
      stock: 8,
      lowStockAt: 2,
    });
    const sebastian = await customerRepository.create({ name: "Cliente F2" });

    // Deuda anterior — NOT a sale
    await customerRepository.recordInitialDebt({
      customerId: sebastian,
      amount: 10_000,
      requestId: "deuda-ant",
    });
    expect(await metricVentas()).toBe(0);
    expect(await metricCaja()).toBe(0);
    expect(await metricFiadoOutstanding()).toBe(10_000);

    await cashRepository.openSession(20_000);

    // Compra 20 × 500 = 10_000 Efectivo
    await inventoryRepository.surtir({
      productId: chicleId,
      qty: 20,
      unitCost: 500,
      totalCost: 10_000,
      method: "Efectivo",
      requestId: "surtir-1",
    });
    expect((await productRepository.getById(chicleId))?.stock).toBe(30);

    // Venta pagada efectivo (custom price) + Nequi + fiada
    await saleRepository.createSale({
      lines: [{ productId: chicleId, qty: 2, unitPrice: 800 }],
      paymentKind: "paid",
      amountReceived: 1_600,
      method: "Efectivo",
      requestId: "v-ef",
    });
    await saleRepository.createSale({
      lines: [{ productId: gomitaId, qty: 1 }],
      paymentKind: "paid",
      amountReceived: 1_500,
      method: "Nequi",
      requestId: "v-nq",
    });
    await saleRepository.createSale({
      lines: [{ productId: chicleId, qty: 3 }],
      paymentKind: "credit",
      customerId: sebastian,
      amountReceived: 0,
      requestId: "v-fiada",
    });

    expect(await metricVentas()).toBe(1_600 + 1_500 + 3_000);
    expect(await metricFiadoOutstanding()).toBe(13_000); // 10k inicial + 3k fiada
    expect(await getDb().cashMoves.where("kind").equals("sale").count()).toBe(2);

    // Catalog price change does not rewrite the 800 sale
    await productRepository.update(chicleId, { price: 2000 });
    const priced = await saleRepository.linesForSale(
      (await saleRepository.list()).find((s) => s.saleTotal === 1_600)!.id!,
    );
    expect(priced[0]?.unitPrice).toBe(800);

    await customerRepository.recordPayment({
      customerId: sebastian,
      amount: 5_000,
      method: "Efectivo",
      requestId: "abono-1",
    });
    expect((await customerRepository.getById(sebastian))?.debt).toBe(8_000);

    await cashRepository.recordExpense({
      amount: 2_000,
      category: "transporte",
      method: "Efectivo",
      requestId: "gasto-1",
    });
    await cashRepository.ownerRetiro(10_000, "Efectivo", undefined, "retiro-1");
    await cashRepository.ownerAporte(5_000, "Nequi", undefined, "aporte-1");

    await inventoryRepository.applyShrink({
      productId: chicleId,
      qty: 1,
      reason: "me_lo_comi",
      requestId: "comi-1",
    });
    await inventoryRepository.applyShrink({
      productId: gomitaId,
      qty: 1,
      reason: "regalar",
      requestId: "regalo-1",
    });
    await inventoryRepository.applyShrink({
      productId: gomitaId,
      qty: 1,
      reason: "perdido",
      note: "se derritió",
      requestId: "perdido-1",
    });

    // Caja esperado Efectivo:
    // 20000 open + 1600 venta + 5000 abono - 10000 compra - 2000 gasto - 10000 retiro
    // = 4600
    const buckets = await cashRepository.expectedBuckets();
    expect(buckets.efectivo).toBe(4_600);
    // Nequi: 1500 venta + 5000 aporte = 6500
    expect(buckets.nequi).toBe(6_500);
    expect(buckets.total).toBe(11_100);

    const stats = await loadStats("hoy");
    expect(stats.ventas).toBe(6_100);
    expect(stats.recibido).toBe(1_600 + 1_500 + 5_000);
    expect(stats.porCobrar).toBe(8_000);
    expect(stats.gaste).toBe(2_000);
    expect(stats.inverti).toBe(10_000);
    const lines = await getDb().saleLines.toArray();
    const expectedGanancia = lines.reduce(
      (s, l) => s + (l.lineTotal - l.qty * l.unitCost),
      0,
    );
    expect(stats.ganancia).toBe(expectedGanancia);
    expect(stats.gaste).not.toBe(10_000);
    expect(stats.inverti).not.toBe(5_000);
    expect(stats.ganancia).not.toBe(buckets.efectivo);

    const session = await cashRepository.getTodaySession();
    await cashRepository.closeSession(session!.id!, 4_600);
    expect((await cashRepository.getTodaySession())?.difference).toBe(0);

    await expect(
      saleRepository.createSale({
        lines: [{ productId: chicleId, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 1000,
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);
    await expect(
      cashRepository.recordExpense({
        amount: 100,
        category: "x",
        method: "Efectivo",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);
    await expect(
      inventoryRepository.surtir({
        productId: chicleId,
        qty: 1,
        unitCost: 1,
        totalCost: 1,
        method: "Efectivo",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);
  });

  it("gasto / surtir / retiro / aporte same requestId do not double", async () => {
    const productId = await productRepository.create({
      name: "X",
      category: "T",
      price: 1000,
      avgCost: 200,
      stock: 5,
      lowStockAt: 1,
    });
    await cashRepository.openSession(50_000);

    const g1 = await cashRepository.recordExpense({
      amount: 1_000,
      category: "bolsas",
      method: "Efectivo",
      requestId: "g-1",
    });
    const g2 = await cashRepository.recordExpense({
      amount: 1_000,
      category: "bolsas",
      method: "Efectivo",
      requestId: "g-1",
    });
    expect(g2).toBe(g1);
    expect(await getDb().expenses.count()).toBe(1);

    const s1 = await inventoryRepository.surtir({
      productId,
      qty: 10,
      unitCost: 300,
      totalCost: 3_000,
      method: "Efectivo",
      requestId: "s-1",
    });
    const s2 = await inventoryRepository.surtir({
      productId,
      qty: 10,
      unitCost: 300,
      totalCost: 3_000,
      method: "Efectivo",
      requestId: "s-1",
    });
    expect(s2).toBe(s1);
    expect((await productRepository.getById(productId))?.stock).toBe(15);

    const r1 = await cashRepository.ownerRetiro(2_000, "Efectivo", undefined, "r-1");
    const r2 = await cashRepository.ownerRetiro(2_000, "Efectivo", undefined, "r-1");
    expect(r2).toBe(r1);

    const a1 = await cashRepository.ownerAporte(4_000, "Nequi", undefined, "a-1");
    const a2 = await cashRepository.ownerAporte(4_000, "Nequi", undefined, "a-1");
    expect(a2).toBe(a1);

    const cash = await getDb().cashMoves.toArray();
    expect(cash.filter((m) => m.kind === "expense")).toHaveLength(1);
    expect(cash.filter((m) => m.kind === "compra")).toHaveLength(1);
    expect(cash.filter((m) => m.kind === "retiro")).toHaveLength(1);
    expect(cash.filter((m) => m.kind === "aporte")).toHaveLength(1);
  });

  it("parallel openSession yields a single day", async () => {
    const [a, b] = await Promise.all([
      cashRepository.openSession(1_000),
      cashRepository.openSession(9_999),
    ]);
    expect(a).toBe(b);
    expect(await getDb().cashSessions.count()).toBe(1);
    const float = (await cashRepository.getTodaySession())?.openingFloat;
    expect(float === 1_000 || float === 9_999).toBe(true);
  });

  it("survives reload", async () => {
    const productId = await productRepository.create({
      name: "Y",
      category: "T",
      price: 500,
      avgCost: 200,
      stock: 4,
      lowStockAt: 1,
    });
    await cashRepository.openSession(0);
    await saleRepository.createSale({
      lines: [{ productId, qty: 1 }],
      paymentKind: "paid",
      amountReceived: 500,
      method: "Efectivo",
    });
    __reopenDbForTests();
    expect(await metricVentas()).toBe(500);
    expect(await metricRecibido()).toBe(500);
    expect((await cashRepository.expectedBuckets()).efectivo).toBe(500);
  });
});
