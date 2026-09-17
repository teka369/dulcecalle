import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, getDb } from "@/storage/db";
import { CASH_ERRORS, localDateKey } from "@/domain/cash";
import { ABONO_ERRORS } from "@/domain/abono";
import { INVENTORY_ERRORS, reconcileSurtirCost } from "@/domain/inventory";
import { loadStats } from "@/repositories/statsRepository";
import {
  cashRepository,
  customerRepository,
  inventoryRepository,
  metricCaja,
  productRepository,
  saleRepository,
} from "@/repositories";
import { isDbEmpty, loadDemoData, wipeLocalData } from "@/storage/seed";

async function seedProduct(opts?: {
  price?: number;
  avgCost?: number;
  stock?: number;
}) {
  return productRepository.create({
    name: "Chicle menta",
    category: "Chicles",
    price: opts?.price ?? 2000,
    avgCost: opts?.avgCost ?? 1000,
    stock: opts?.stock ?? 20,
    lowStockAt: 3,
  });
}

describe("P0 custom sale price snapshots", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("stores the charged unitPrice, not later catalog price", async () => {
    const productId = await seedProduct({ price: 2000, avgCost: 1000, stock: 10 });

    const saleId = await saleRepository.createSale({
      lines: [{ productId, qty: 2, unitPrice: 1500 }],
      paymentKind: "paid",
      amountReceived: 3000,
      method: "Efectivo",
    });

    const sale = await saleRepository.getById(saleId);
    const lines = await saleRepository.linesForSale(saleId);
    expect(sale?.saleTotal).toBe(3000);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.unitPrice).toBe(1500);
    expect(lines[0]?.unitCost).toBe(1000);
    expect(lines[0]?.qty).toBe(2);
    expect(lines[0]?.lineTotal).toBe(3000);

    await productRepository.update(productId, { price: 2500, avgCost: 1800 });
    const after = await saleRepository.linesForSale(saleId);
    expect(after[0]?.unitPrice).toBe(1500);
    expect(after[0]?.unitCost).toBe(1000);
    expect(after[0]?.lineTotal).toBe(3000);

    const stats = await loadStats("hoy");
    expect(stats.ganancia).toBe(1000); // (1500-1000)*2
    expect(stats.ventas).toBe(3000);
  });

  it("historical profit stays put after restock changes avgCost", async () => {
    const productId = await seedProduct({ price: 2000, avgCost: 1000, stock: 5 });
    await saleRepository.createSale({
      lines: [{ productId, qty: 1, unitPrice: 1500 }],
      paymentKind: "paid",
      amountReceived: 1500,
    });
    await inventoryRepository.surtir({
      productId,
      qty: 10,
      unitCost: 2000,
      totalCost: 20_000,
      method: "Efectivo",
    });
    const product = await productRepository.getById(productId);
    expect(product?.avgCost).not.toBe(1000);

    const stats = await loadStats("hoy");
    expect(stats.ganancia).toBe(500);
    const lines = await getDb().saleLines.toArray();
    expect(lines[0]?.unitCost).toBe(1000);
  });

  it("rejects negative custom price", async () => {
    const productId = await seedProduct();
    await expect(
      saleRepository.createSale({
        lines: [{ productId, qty: 1, unitPrice: -1 }],
        paymentKind: "paid",
        amountReceived: 0,
      }),
    ).rejects.toThrow();
  });

  it("falls back to catalog price when override omitted", async () => {
    const productId = await seedProduct({ price: 2000, stock: 5 });
    const saleId = await saleRepository.createSale({
      lines: [{ productId, qty: 1 }],
      paymentKind: "paid",
      amountReceived: 2000,
    });
    const lines = await saleRepository.linesForSale(saleId);
    expect(lines[0]?.unitPrice).toBe(2000);
    expect(lines[0]?.lineTotal).toBe(2000);
  });
});

describe("P0 closed day blocks every mutation", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  async function openThenClose() {
    const productId = await seedProduct({ stock: 10, avgCost: 400, price: 1000 });
    const customerId = await customerRepository.create({ name: "Ana" });
    await cashRepository.openSession(0);
    await saleRepository.createSale({
      lines: [{ productId, qty: 1, unitPrice: 1000 }],
      paymentKind: "credit",
      customerId,
      amountReceived: 0,
    });
    const session = await cashRepository.getTodaySession();
    await cashRepository.closeSession(session!.id!, 0);
    return { productId, customerId };
  }

  it("allows operations while the day is open", async () => {
    const productId = await seedProduct({ stock: 10, price: 1000 });
    await cashRepository.openSession(0);
    const saleId = await saleRepository.createSale({
      lines: [{ productId, qty: 1 }],
      paymentKind: "paid",
      amountReceived: 1000,
    });
    expect(saleId).toBeTruthy();
  });

  it("rejects sale / abono / surtir / shrink / gasto / retiro / aporte / cashMove", async () => {
    const { productId, customerId } = await openThenClose();

    await expect(
      saleRepository.createSale({
        lines: [{ productId, qty: 1 }],
        paymentKind: "paid",
        amountReceived: 1000,
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);

    await expect(
      customerRepository.recordPayment({
        customerId,
        amount: 100,
        method: "Efectivo",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);

    await expect(
      inventoryRepository.surtir({
        productId,
        qty: 1,
        unitCost: 100,
        totalCost: 100,
        method: "Efectivo",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);

    await expect(
      inventoryRepository.applyShrink({
        productId,
        qty: 1,
        reason: "me_lo_comi",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);

    await expect(
      inventoryRepository.applyMove({
        productId,
        delta: -1,
        reason: "perdido",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);

    await expect(
      cashRepository.recordExpense({
        amount: 100,
        category: "bolsas",
        method: "Efectivo",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);

    await expect(cashRepository.ownerRetiro(100)).rejects.toThrow(
      CASH_ERRORS.dayClosed,
    );
    await expect(cashRepository.ownerAporte(100)).rejects.toThrow(
      CASH_ERRORS.dayClosed,
    );
    await expect(
      cashRepository.recordMove({
        amount: 100,
        direction: "in",
        method: "Efectivo",
        kind: "aporte",
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);
  });

  it("rejects backdated surtir into a closed day even if today is open", async () => {
    const productId = await seedProduct({ stock: 5 });
    const y = new Date();
    y.setDate(y.getDate() - 1);
    y.setHours(12, 0, 0, 0);
    const yesterdayNoon = y.getTime();
    const yesterdayKey = localDateKey(yesterdayNoon);

    await getDb().cashSessions.add({
      localDate: yesterdayKey,
      openedAt: yesterdayNoon - 4 * 3600_000,
      closedAt: yesterdayNoon + 4 * 3600_000,
      openingFloat: 0,
      closingCount: 0,
    });

    await cashRepository.openSession(0);

    await expect(
      inventoryRepository.surtir({
        productId,
        qty: 2,
        unitCost: 100,
        totalCost: 200,
        method: "Efectivo",
        createdAt: yesterdayNoon,
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);
  });
});

describe("P0 caja formula", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("balance() is cashMoves only; expected includes openingFloat", async () => {
    await cashRepository.openSession(5_000);
    await cashRepository.ownerAporte(10_000, "Efectivo");
    await cashRepository.ownerAporte(3_000, "Nequi");
    await cashRepository.recordExpense({
      amount: 2_000,
      category: "bolsas",
      method: "Efectivo",
    });

    // Ledger: +10000 +3000 -2000 = 11000 (opening is NOT a move)
    expect(await metricCaja()).toBe(11_000);
    expect(await cashRepository.balance()).toBe(11_000);

    const expected = await cashRepository.expectedBuckets();
    // Efectivo: 5000 opening + 10000 aporte - 2000 gasto = 13000
    expect(expected.efectivo).toBe(13_000);
    expect(expected.nequi).toBe(3_000);
    expect(expected.total).toBe(16_000);
  });
});

describe("P0 fiados and abonos", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("rejects overpay, missing customer, and never goes negative", async () => {
    const productId = await seedProduct({ price: 1000, stock: 10 });
    const customerId = await customerRepository.create({ name: "Rosa" });
    await saleRepository.createSale({
      lines: [{ productId, qty: 5 }],
      paymentKind: "credit",
      customerId,
      amountReceived: 0,
    });

    await expect(
      customerRepository.recordPayment({
        customerId,
        amount: 5_001,
        method: "Efectivo",
      }),
    ).rejects.toThrow(ABONO_ERRORS.exceedsDebt);

    await expect(
      customerRepository.recordPayment({
        customerId: 99999,
        amount: 100,
        method: "Efectivo",
      }),
    ).rejects.toThrow("customer not found");

    await customerRepository.recordPayment({
      customerId,
      amount: 5_000,
      method: "Efectivo",
    });
    const c = await customerRepository.getById(customerId);
    expect(c?.debt).toBe(0);
  });

  it("same requestId does not double-collect", async () => {
    const productId = await seedProduct({ price: 1000, stock: 10 });
    const customerId = await customerRepository.create({ name: "Rosa" });
    await saleRepository.createSale({
      lines: [{ productId, qty: 4 }],
      paymentKind: "credit",
      customerId,
      amountReceived: 0,
    });

    const first = await customerRepository.recordPayment({
      customerId,
      amount: 1_000,
      method: "Efectivo",
      requestId: "abono-1",
    });
    const second = await customerRepository.recordPayment({
      customerId,
      amount: 1_000,
      method: "Efectivo",
      requestId: "abono-1",
    });
    expect(second).toBe(first);
    const c = await customerRepository.getById(customerId);
    expect(c?.debt).toBe(3_000);
    const payments = await customerRepository.listPayments(customerId);
    expect(payments).toHaveLength(1);
  });

  it("mixed sale: received cash + remaining debt", async () => {
    const productId = await seedProduct({ price: 1000, stock: 10 });
    const customerId = await customerRepository.create({ name: "Rosa" });
    await saleRepository.createSale({
      lines: [{ productId, qty: 5 }],
      paymentKind: "partial",
      customerId,
      amountReceived: 2_000,
      method: "Nequi",
    });
    const c = await customerRepository.getById(customerId);
    expect(c?.debt).toBe(3_000);
    const moves = await getDb().cashMoves.toArray();
    expect(moves.some((m) => m.kind === "sale" && m.method === "Nequi")).toBe(
      true,
    );
  });
});

describe("P0.5 sale idempotency", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("same requestId creates a single sale (stock/cash once)", async () => {
    const productId = await seedProduct({ price: 1000, stock: 10 });
    const input = {
      lines: [{ productId, qty: 2, unitPrice: 1000 }],
      paymentKind: "paid" as const,
      amountReceived: 2000,
      method: "Efectivo" as const,
      requestId: "sale-1",
    };

    const first = await saleRepository.createSale(input);
    const second = await saleRepository.createSale(input);
    expect(second).toBe(first);

    const sales = await saleRepository.list();
    expect(sales).toHaveLength(1);
    expect((await productRepository.getById(productId))?.stock).toBe(8);
    const cash = await getDb().cashMoves.toArray();
    expect(cash.filter((m) => m.kind === "sale")).toHaveLength(1);
    const moves = await getDb().stockMoves.toArray();
    expect(moves.filter((m) => m.reason === "sale")).toHaveLength(1);
  });

  it("different requestIds create two valid sales", async () => {
    const productId = await seedProduct({ price: 1000, stock: 10 });
    const base = {
      lines: [{ productId, qty: 1, unitPrice: 1000 }],
      paymentKind: "paid" as const,
      amountReceived: 1000,
      method: "Efectivo" as const,
    };

    const a = await saleRepository.createSale({ ...base, requestId: "sale-a" });
    const b = await saleRepository.createSale({ ...base, requestId: "sale-b" });
    expect(a).not.toBe(b);

    expect(await saleRepository.list()).toHaveLength(2);
    expect((await productRepository.getById(productId))?.stock).toBe(8);
    const cash = await getDb().cashMoves.toArray();
    expect(cash.filter((m) => m.kind === "sale")).toHaveLength(2);
  });

  it("same requestId does not double debt on a fiada", async () => {
    const productId = await seedProduct({ price: 1000, stock: 10 });
    const customerId = await customerRepository.create({ name: "Rosa" });
    const input = {
      lines: [{ productId, qty: 3 }],
      paymentKind: "credit" as const,
      customerId,
      amountReceived: 0,
      requestId: "fiada-1",
    };

    const first = await saleRepository.createSale(input);
    const second = await saleRepository.createSale(input);
    expect(second).toBe(first);
    expect((await customerRepository.getById(customerId))?.debt).toBe(3_000);
    expect(await saleRepository.list()).toHaveLength(1);
  });

  it("parallel same requestId still yields one sale", async () => {
    const productId = await seedProduct({ price: 1000, stock: 10 });
    const input = {
      lines: [{ productId, qty: 1 }],
      paymentKind: "paid" as const,
      amountReceived: 1000,
      requestId: "sale-race",
    };

    const [a, b] = await Promise.all([
      saleRepository.createSale(input),
      saleRepository.createSale(input),
    ]);
    expect(a).toBe(b);
    expect(await saleRepository.list()).toHaveLength(1);
    expect((await productRepository.getById(productId))?.stock).toBe(9);
  });
});

describe("P0 inventory integrity", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("never allows stock < 0 and rejects qty 0", async () => {
    const productId = await seedProduct({ stock: 2 });
    await expect(
      inventoryRepository.applyShrink({
        productId,
        qty: 3,
        reason: "perdido",
        note: "x",
      }),
    ).rejects.toThrow(INVENTORY_ERRORS.insufficientStock);
    expect((await productRepository.getById(productId))?.stock).toBe(2);

    await expect(
      inventoryRepository.surtir({
        productId,
        qty: 0,
        unitCost: 1,
        totalCost: 0,
        method: "Efectivo",
      }),
    ).rejects.toThrow(INVENTORY_ERRORS.notPositive);
  });

  it("blocks direct stock patches on the product", async () => {
    const productId = await seedProduct({ stock: 5 });
    await expect(
      productRepository.update(productId, { stock: 99 }),
    ).rejects.toThrow(INVENTORY_ERRORS.stockViaMoves);
    expect((await productRepository.getById(productId))?.stock).toBe(5);
  });

  it("create with stock writes inicial move, not a compra", async () => {
    const productId = await seedProduct({ stock: 7, avgCost: 400 });
    const p = await productRepository.getById(productId);
    expect(p?.stock).toBe(7);
    const moves = await inventoryRepository.listMoves(productId);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.reason).toBe("inicial");
    expect(moves[0]?.delta).toBe(7);
    expect(moves[0]?.unitCost).toBe(400);
    expect(await getDb().cashMoves.count()).toBe(0);
  });

  it("create with stock 0 writes no stockMove", async () => {
    const productId = await seedProduct({ stock: 0 });
    expect(await inventoryRepository.listMoves(productId)).toHaveLength(0);
  });

  it("applyMove cannot mint inicial stock", async () => {
    const productId = await seedProduct({ stock: 3 });
    await expect(
      inventoryRepository.applyMove({
        productId,
        delta: 5,
        reason: "inicial",
      }),
    ).rejects.toThrow(INVENTORY_ERRORS.inicialViaCreate);
    expect((await productRepository.getById(productId))?.stock).toBe(3);
  });
});

describe("P0 surtir cost reconciliation", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("contradictory unit vs total: total wins, unit = round(total/qty)", () => {
    expect(reconcileSurtirCost(10, 500, 7000)).toEqual({
      unitCost: 700,
      totalCost: 7000,
    });
    expect(reconcileSurtirCost(10, 500, 5000)).toEqual({
      unitCost: 500,
      totalCost: 5000,
    });
  });

  it("surtir persists reconciled unit and cash out", async () => {
    const productId = await seedProduct({ stock: 0, avgCost: 0 });
    await inventoryRepository.surtir({
      productId,
      qty: 10,
      unitCost: 500,
      totalCost: 7000,
      method: "Efectivo",
    });
    const p = await productRepository.getById(productId);
    expect(p?.avgCost).toBe(700);
    expect(p?.stock).toBe(10);
    const cash = await getDb().cashMoves.toArray();
    expect(cash[0]?.amount).toBe(7000);
    const moves = await inventoryRepository.listMoves(productId);
    expect(moves[0]?.unitCost).toBe(700);
  });
});

describe("P0 demo wipe", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("wipeLocalData clears demo so Inicio can seed again", async () => {
    await loadDemoData();
    expect(await isDbEmpty()).toBe(false);
    await wipeLocalData();
    expect(await isDbEmpty()).toBe(true);
    await loadDemoData();
    expect(await isDbEmpty()).toBe(false);
  });
});
