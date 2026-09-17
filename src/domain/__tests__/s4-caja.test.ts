import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, __reopenDbForTests } from "@/storage/db";
import {
  CASH_COPY,
  CASH_ERRORS,
  differenceLabel,
  localDateKey,
  validateCashAmount,
  validateCounted,
  validateGasto,
} from "@/domain/cash";
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

describe("S4 Caja — distinct kinds & session rules", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("keeps gasto ≠ retiro ≠ aporte (and ≠ venta/abono/surtir)", async () => {
    await cashRepository.openSession(0);

    const expenseId = await cashRepository.recordExpense({
      amount: 5_000,
      category: "transporte",
      method: "Efectivo",
    });
    const retiroId = await cashRepository.ownerRetiro(10_000, "Efectivo");
    const aporteId = await cashRepository.ownerAporte(50_000, "Efectivo");

    const moves = await cashRepository.listMoves();
    const kinds = moves.map((m) => m.kind);
    expect(kinds).toContain("expense");
    expect(kinds).toContain("retiro");
    expect(kinds).toContain("aporte");
    expect(kinds).not.toContain("sale");
    expect(kinds).not.toContain("debt_collect");
    expect(kinds).not.toContain("compra");

    const expense = moves.find((m) => m.kind === "expense");
    const retiro = moves.find((m) => m.kind === "retiro");
    const aporte = moves.find((m) => m.kind === "aporte");
    expect(expense?.direction).toBe("out");
    expect(retiro?.direction).toBe("out");
    expect(aporte?.direction).toBe("in");
    expect(expenseId).toBeTruthy();
    expect(retiroId).toBeTruthy();
    expect(aporteId).toBeTruthy();

    // Not the same kind strings
    expect(expense!.kind).not.toBe(retiro!.kind);
    expect(retiro!.kind).not.toBe(aporte!.kind);
    expect(aporte!.kind).not.toBe(expense!.kind);
  });

  it("enforces 1 session/day with Efectivo|Nequi buckets", async () => {
    const id = await cashRepository.openSession(2_000);
    expect(id).toBeTruthy();

    await expect(cashRepository.openSession(0)).rejects.toThrow(
      CASH_ERRORS.sessionAlreadyOpen,
    );

    await cashRepository.ownerAporte(10_000, "Efectivo");
    await cashRepository.ownerAporte(3_000, "Nequi");
    await cashRepository.recordExpense({
      amount: 1_000,
      category: "bolsas",
      method: "Efectivo",
    });

    const buckets = await cashRepository.expectedBuckets();
    // opening 2000 + aporte 10000 - expense 1000 = 11000 Efectivo
    expect(buckets.efectivo).toBe(11_000);
    expect(buckets.nequi).toBe(3_000);
    expect(buckets.total).toBe(14_000);

    const session = await cashRepository.getTodaySession();
    expect(session?.localDate).toBe(localDateKey());
    expect(session?.closedAt).toBeNull();
  });

  it("close: expected vs counted + difference; Nequi not in physical count", async () => {
    await cashRepository.openSession(0);
    await cashRepository.ownerAporte(20_000, "Efectivo");
    await cashRepository.ownerAporte(5_000, "Nequi");
    await cashRepository.ownerRetiro(2_000, "Efectivo");

    const expected = await cashRepository.expectedBuckets();
    expect(expected.efectivo).toBe(18_000);
    expect(expected.nequi).toBe(5_000);

    const session = await cashRepository.getTodaySession();
    // Count only physical Efectivo — short by 1000
    await cashRepository.closeSession(session!.id!, 17_000);

    const closed = await cashRepository.getTodaySession();
    expect(closed?.closedAt).not.toBeNull();
    expect(closed?.closingCount).toBe(17_000);
    expect(closed?.expectedEfectivo).toBe(18_000);
    expect(closed?.expectedNequi).toBe(5_000);
    expect(closed?.difference).toBe(-1_000);
    expect(differenceLabel(-1_000)).toBe("Faltante");
    expect(differenceLabel(0)).toBe("Cuadra");
    expect(differenceLabel(500)).toBe("Sobrante");
  });

  it("blocks edits after close with locked copy", async () => {
    await cashRepository.openSession(0);
    await cashRepository.ownerAporte(5_000, "Efectivo");
    const session = await cashRepository.getTodaySession();
    await cashRepository.closeSession(session!.id!, 5_000);

    await expect(
      cashRepository.recordExpense({
        amount: 1_000,
        category: "x",
        method: "Efectivo",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);

    await expect(cashRepository.ownerRetiro(1_000)).rejects.toThrow(
      CASH_ERRORS.dayClosed,
    );
    await expect(cashRepository.ownerAporte(1_000)).rejects.toThrow(
      CASH_ERRORS.dayClosed,
    );
    await expect(cashRepository.openSession(0)).rejects.toThrow(
      CASH_ERRORS.dayClosedAlt,
    );
  });

  it("rejects amount <= 0; gasto/retiro/aporte never touch stock", async () => {
    const productId = await productRepository.create({
      name: "X",
      category: "T",
      price: 1000,
      avgCost: 500,
      stock: 10,
      lowStockAt: 2,
    });

    await cashRepository.openSession(0);

    await expect(cashRepository.ownerAporte(0)).rejects.toThrow();
    await expect(cashRepository.ownerRetiro(-1)).rejects.toThrow();
    await expect(
      cashRepository.recordExpense({
        amount: 0,
        category: "x",
      }),
    ).rejects.toThrow();

    await cashRepository.recordExpense({
      amount: 500,
      category: "gas",
      method: "Nequi",
    });
    await cashRepository.ownerRetiro(500, "Efectivo");
    await cashRepository.ownerAporte(1_000, "Nequi");

    const product = await productRepository.getById(productId);
    expect(product?.stock).toBe(10);
    const stockMoves = await inventoryRepository.listMoves(productId);
    expect(stockMoves).toHaveLength(0);
  });

  it("persists session + moves across reload (Dexie)", async () => {
    await cashRepository.openSession(1_000);
    await cashRepository.ownerAporte(4_000, "Efectivo");
    await cashRepository.recordExpense({
      amount: 500,
      category: "transporte",
      method: "Efectivo",
    });

    __reopenDbForTests();

    const summary = await cashRepository.daySummary();
    expect(summary.session?.openingFloat).toBe(1_000);
    expect(summary.expected.efectivo).toBe(4_500);
    expect(summary.moves.length).toBeGreaterThanOrEqual(2);
    expect(summary.closed).toBe(false);
  });

  it("Day1 path: transporte 5k + retiro 10k + aporte 50k → Caja 17000", async () => {
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

    // After close, S4 mutations blocked
    await expect(
      cashRepository.recordExpense({ amount: 100, category: "x" }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);
  });
});

describe("S4 validation + locked copy", () => {
  it("gasto validation errors (exact strings)", () => {
    expect(
      validateGasto({ amountRaw: "", categoryRaw: "x", method: "Efectivo" }),
    ).toBe(CASH_ERRORS.emptyAmount);
    expect(
      validateGasto({ amountRaw: "0", categoryRaw: "x", method: "Efectivo" }),
    ).toBe(CASH_ERRORS.notPositive);
    expect(
      validateGasto({ amountRaw: "100", categoryRaw: "x", method: null }),
    ).toBe(CASH_ERRORS.noMethod);
    expect(
      validateGasto({
        amountRaw: "100",
        categoryRaw: "  ",
        method: "Efectivo",
      }),
    ).toBe(CASH_ERRORS.emptyCategory);
  });

  it("retiro/aporte amount validation", () => {
    expect(validateCashAmount({ amountRaw: "", method: "Nequi" })).toBe(
      CASH_ERRORS.emptyAmount,
    );
    expect(validateCashAmount({ amountRaw: "10", method: "Efectivo" })).toBe(
      null,
    );
  });

  it("counted validation + Tanda captions present", () => {
    expect(validateCounted("")).toBe(CASH_ERRORS.emptyCounted);
    expect(validateCounted("100")).toBe(null);
    expect(CASH_COPY.gastoCaption).toBe(
      "Esto es un gasto del negocio, no un retiro tuyo.",
    );
    expect(CASH_COPY.retiroCaption).toBe(
      "Plata que tú sacas. No es un gasto.",
    );
    expect(CASH_COPY.aporteCaption).toBe(
      "Plata que tú metes al negocio.",
    );
    expect(CASH_COPY.cajaEsperado).toBe("Caja esperado");
    expect(CASH_COPY.abrirCaja).toBe("Abrir caja");
    expect(CASH_COPY.cerrarCaja).toBe("Cerrar caja");
    expect(CASH_COPY.noSePuedeEditar).toBe("No se puede editar el día.");
    expect(CASH_COPY.elDiaEstaCerrado).toBe("El día está cerrado.");
    expect(CASH_COPY.cerrarConDiferencia).toBe("¿Cerrar con diferencia?");
    // No Contar caja CTA in locked copy object as primary action label
    expect(
      Object.values(CASH_COPY).includes("Contar caja" as never),
    ).toBe(false);
  });
});
