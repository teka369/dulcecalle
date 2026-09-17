import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, getDb } from "@/storage/db";
import { ABONO_ERRORS } from "@/domain/abono";
import {
  customerRepository,
  metricFiadoOutstanding,
  metricRecibido,
  metricVentas,
  productRepository,
  saleRepository,
} from "@/repositories";

/**
 * Tester QA S2 — abono rules + persistence.
 * Keep metrics separate: debt collection ≠ new sale.
 */
describe("S2 abono rules + persistence", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  async function seedCustomerWithDebt(debtViaSale = 5_000) {
    const productId = await productRepository.create({
      name: "Dulce S2",
      category: "Test",
      price: 1000,
      avgCost: 400,
      stock: 50,
      lowStockAt: 5,
    });
    const customerId = await customerRepository.create({ name: "Ana Pérez" });
    await saleRepository.createSale({
      lines: [{ productId, qty: debtViaSale / 1000 }],
      paymentKind: "credit",
      customerId,
      amountReceived: 0,
    });
    return { productId, customerId, debt: debtViaSale };
  }

  it("partial abono decreases debt and persists payment + cashMove", async () => {
    const { customerId } = await seedCustomerWithDebt(5_000);
    await customerRepository.recordPayment({
      customerId,
      amount: 2_000,
      method: "Efectivo",
    });

    const customer = await customerRepository.getById(customerId);
    expect(customer?.debt).toBe(3_000);

    const payments = await customerRepository.listPayments(customerId);
    expect(payments).toHaveLength(1);
    expect(payments[0]?.amount).toBe(2_000);
    expect(payments[0]?.method).toBe("Efectivo");

    const moves = await getDb().cashMoves.toArray();
    const abonoMove = moves.find((m) => m.kind === "debt_collect");
    expect(abonoMove).toBeTruthy();
    expect(abonoMove?.amount).toBe(2_000);
    expect(abonoMove?.method).toBe("Efectivo");
    expect(abonoMove?.direction).toBe("in");
  });

  it("total abono brings debt to 0", async () => {
    const { customerId } = await seedCustomerWithDebt(5_000);
    await customerRepository.recordPayment({
      customerId,
      amount: 5_000,
      method: "Nequi",
    });
    const customer = await customerRepository.getById(customerId);
    expect(customer?.debt).toBe(0);
    expect(customer!.debt).toBeGreaterThanOrEqual(0);
  });

  it("rejects overpay", async () => {
    const { customerId } = await seedCustomerWithDebt(5_000);
    await expect(
      customerRepository.recordPayment({
        customerId,
        amount: 5_001,
        method: "Efectivo",
      }),
    ).rejects.toThrow(ABONO_ERRORS.exceedsDebt);
    const customer = await customerRepository.getById(customerId);
    expect(customer?.debt).toBe(5_000);
  });

  it("rejects amount <= 0", async () => {
    const { customerId } = await seedCustomerWithDebt(5_000);
    await expect(
      customerRepository.recordPayment({
        customerId,
        amount: 0,
        method: "Efectivo",
      }),
    ).rejects.toThrow(ABONO_ERRORS.notPositive);
  });

  it("rejects missing/invalid method", async () => {
    const { customerId } = await seedCustomerWithDebt(5_000);
    await expect(
      customerRepository.recordPayment({
        customerId,
        amount: 1000,
        method: "Bitcoin" as never,
      }),
    ).rejects.toThrow(ABONO_ERRORS.noMethod);
  });

  it("records Efectivo and Nequi on separate abonos", async () => {
    const { customerId } = await seedCustomerWithDebt(5_000);
    await customerRepository.recordPayment({
      customerId,
      amount: 1_000,
      method: "Efectivo",
    });
    await customerRepository.recordPayment({
      customerId,
      amount: 1_500,
      method: "Nequi",
    });
    const payments = await customerRepository.listPayments(customerId);
    expect(payments.map((p) => p.method).sort()).toEqual(["Efectivo", "Nequi"]);
  });

  it("debt always ≥ 0 after abonos", async () => {
    const { customerId } = await seedCustomerWithDebt(5_000);
    await customerRepository.recordPayment({
      customerId,
      amount: 2_000,
      method: "Efectivo",
    });
    await customerRepository.recordPayment({
      customerId,
      amount: 3_000,
      method: "Nequi",
    });
    const customer = await customerRepository.getById(customerId);
    expect(customer?.debt).toBe(0);
    expect(customer!.debt).toBeGreaterThanOrEqual(0);
  });

  it("Recibido increases with abonos; Ventas unchanged; Fiado === sum debts", async () => {
    const { customerId, productId } = await seedCustomerWithDebt(5_000);

    // Second customer with separate debt
    const customerId2 = await customerRepository.create({ name: "Carlos" });
    await saleRepository.createSale({
      lines: [{ productId, qty: 2 }],
      paymentKind: "credit",
      customerId: customerId2,
      amountReceived: 0,
    });

    const ventasBefore = await metricVentas();
    const recibidoBefore = await metricRecibido();
    expect(await metricFiadoOutstanding()).toBe(7_000);

    await customerRepository.recordPayment({
      customerId,
      amount: 2_000,
      method: "Efectivo",
    });

    // Debt collection ≠ new sale
    expect(await metricVentas()).toBe(ventasBefore);
    expect(await metricRecibido()).toBe(recibidoBefore + 2_000);

    const all = await customerRepository.list();
    const sumDebts = all.reduce((s, c) => s + c.debt, 0);
    expect(await metricFiadoOutstanding()).toBe(sumDebts);
    expect(sumDebts).toBe(5_000); // 3000 + 2000
  });

  it("persists history entries for ficha", async () => {
    const { customerId } = await seedCustomerWithDebt(5_000);
    await customerRepository.recordPayment({
      customerId,
      amount: 1_000,
      method: "Efectivo",
    });
    const history = await customerRepository.listHistory(customerId);
    expect(history.some((h) => h.kind === "abono")).toBe(true);
    expect(history.some((h) => h.kind === "fiada")).toBe(true);
  });
});
