import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, getDb } from "@/storage/db";
import { INITIAL_DEBT_ERRORS } from "@/domain/initialDebt";
import { CASH_ERRORS } from "@/domain/cash";
import { loadStats } from "@/repositories/statsRepository";
import {
  cashRepository,
  customerRepository,
  metricCaja,
  metricFiadoOutstanding,
  metricRecibido,
  metricVentas,
  productRepository,
  saleRepository,
} from "@/repositories";

describe("Initial debt (deuda anterior)", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  async function seedCustomer() {
    return customerRepository.create({ name: "Sebastián" });
  }

  it("increases current debt and writes a traceable row", async () => {
    const customerId = await seedCustomer();
    expect((await customerRepository.getById(customerId))?.debt).toBe(0);

    const id = await customerRepository.recordInitialDebt({
      customerId,
      amount: 5_000,
      requestId: "inicial-1",
    });
    expect(id).toBeTruthy();
    expect((await customerRepository.getById(customerId))?.debt).toBe(5_000);

    const history = await customerRepository.listHistory(customerId);
    expect(history).toHaveLength(1);
    expect(history[0]?.kind).toBe("inicial");
    expect(history[0]?.amount).toBe(5_000);
    expect(history[0]?.label).toBe("Deuda anterior");
  });

  it("does not create a sale, saleLines, cash, or stock moves", async () => {
    const customerId = await seedCustomer();
    await customerRepository.recordInitialDebt({
      customerId,
      amount: 16_800,
      requestId: "inicial-no-sale",
    });

    const db = getDb();
    expect(await db.sales.count()).toBe(0);
    expect(await db.saleLines.count()).toBe(0);
    expect(await db.cashMoves.count()).toBe(0);
    expect(await db.stockMoves.count()).toBe(0);
    expect(await db.customerPayments.count()).toBe(0);
  });

  it("same requestId does not double the debt", async () => {
    const customerId = await seedCustomer();
    const first = await customerRepository.recordInitialDebt({
      customerId,
      amount: 5_000,
      requestId: "ABC",
    });
    const second = await customerRepository.recordInitialDebt({
      customerId,
      amount: 5_000,
      requestId: "ABC",
    });
    expect(second).toBe(first);
    expect((await customerRepository.getById(customerId))?.debt).toBe(5_000);
    expect(await getDb().initialDebts.count()).toBe(1);
  });

  it("different requestIds are two valid operations", async () => {
    const customerId = await seedCustomer();
    const a = await customerRepository.recordInitialDebt({
      customerId,
      amount: 3_100,
      requestId: "pablo-1",
    });
    const b = await customerRepository.recordInitialDebt({
      customerId,
      amount: 800,
      requestId: "pablo-2",
    });
    expect(a).not.toBe(b);
    expect((await customerRepository.getById(customerId))?.debt).toBe(3_900);
    expect(await getDb().initialDebts.count()).toBe(2);
  });

  it("abono after initial debt decreases debt and hits caja", async () => {
    const customerId = await seedCustomer();
    await customerRepository.recordInitialDebt({
      customerId,
      amount: 5_000,
      requestId: "inicial-abono",
    });
    await customerRepository.recordPayment({
      customerId,
      amount: 2_000,
      method: "Efectivo",
    });

    expect((await customerRepository.getById(customerId))?.debt).toBe(3_000);
    expect(await metricCaja()).toBe(2_000);
    const moves = await getDb().cashMoves.toArray();
    expect(moves).toHaveLength(1);
    expect(moves[0]?.kind).toBe("debt_collect");
    expect(moves[0]?.amount).toBe(2_000);
  });

  it("does not bump Ventas, Recibido, period credit-sales, or Caja — only current debt", async () => {
    const customerId = await seedCustomer();
    const ventasBefore = await metricVentas();
    const recibidoBefore = await metricRecibido();
    const cajaBefore = await metricCaja();
    const statsBefore = await loadStats("hoy");

    await customerRepository.recordInitialDebt({
      customerId,
      amount: 16_800,
      requestId: "stats-1",
    });

    expect(await metricVentas()).toBe(ventasBefore);
    expect(await metricRecibido()).toBe(recibidoBefore);
    expect(await metricCaja()).toBe(cajaBefore);
    expect(await metricFiadoOutstanding()).toBe(16_800);

    const stats = await loadStats("hoy");
    expect(stats.ventas).toBe(statsBefore.ventas);
    expect(stats.recibido).toBe(statsBefore.recibido);
    expect(stats.ganancia).toBe(statsBefore.ganancia);
    expect(stats.ventasCount).toBe(0);
    expect(stats.porCobrar).toBe(16_800);
  });

  it("rejects 0, negative, NaN, and missing customer", async () => {
    const customerId = await seedCustomer();

    await expect(
      customerRepository.recordInitialDebt({ customerId, amount: 0 }),
    ).rejects.toThrow(INITIAL_DEBT_ERRORS.notPositive);
    await expect(
      customerRepository.recordInitialDebt({ customerId, amount: -100 }),
    ).rejects.toThrow(INITIAL_DEBT_ERRORS.notPositive);
    await expect(
      customerRepository.recordInitialDebt({ customerId, amount: Number.NaN }),
    ).rejects.toThrow(INITIAL_DEBT_ERRORS.empty);
    await expect(
      customerRepository.recordInitialDebt({
        customerId: 99999,
        amount: 500,
      }),
    ).rejects.toThrow("customer not found");

    expect((await customerRepository.getById(customerId))?.debt).toBe(0);
    expect(await getDb().initialDebts.count()).toBe(0);
  });

  it("is allowed on a closed day (carga inicial, not caja)", async () => {
    const customerId = await seedCustomer();
    await cashRepository.openSession(0);
    const session = await cashRepository.getTodaySession();
    await cashRepository.closeSession(session!.id!, 0);

    await expect(
      customerRepository.recordPayment({
        customerId,
        amount: 100,
        method: "Efectivo",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);

    await customerRepository.recordInitialDebt({
      customerId,
      amount: 3_500,
      requestId: "closed-day",
    });
    expect((await customerRepository.getById(customerId))?.debt).toBe(3_500);
    expect(await getDb().cashMoves.count()).toBe(0);
  });

  it("create() cannot smuggle opening debt", async () => {
    await expect(
      customerRepository.create({ name: "Pablo", debt: 3_100 }),
    ).rejects.toThrow();
  });
});

describe("Initial debt vs a later fiada sale", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("history shows inicial, then fiada, then abono — debt math holds", async () => {
    const productId = await productRepository.create({
      name: "Chicle",
      category: "Chicles",
      price: 1000,
      avgCost: 400,
      stock: 10,
      lowStockAt: 2,
    });
    const customerId = await customerRepository.create({ name: "Ana" });

    await customerRepository.recordInitialDebt({
      customerId,
      amount: 5_000,
      requestId: "open",
    });
    await saleRepository.createSale({
      lines: [{ productId, qty: 3 }],
      paymentKind: "credit",
      customerId,
      amountReceived: 0,
    });
    await customerRepository.recordPayment({
      customerId,
      amount: 2_000,
      method: "Nequi",
    });

    expect((await customerRepository.getById(customerId))?.debt).toBe(6_000);
    const kinds = (await customerRepository.listHistory(customerId)).map(
      (h) => h.kind,
    );
    expect(kinds).toContain("inicial");
    expect(kinds).toContain("fiada");
    expect(kinds).toContain("abono");
    expect(await metricVentas()).toBe(3_000);
    expect(await metricRecibido()).toBe(2_000);
  });
});
