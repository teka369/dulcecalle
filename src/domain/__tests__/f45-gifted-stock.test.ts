import { beforeEach, describe, expect, it } from "vitest";
import { GIFTED_STOCK_NOTE, INVENTORY_ERRORS } from "@/domain/inventory";
import {
  cashRepository,
  inventoryRepository,
  productRepository,
  saleRepository,
} from "@/repositories";
import { loadStats } from "@/repositories/statsRepository";
import { __resetDbForTests, getDb } from "@/storage/db";

async function createGifted(stock = 15, price = 1000) {
  return productRepository.create({
    name: "Galleta de chocolate italiano",
    category: "General",
    price,
    avgCost: 0,
    stock,
    lowStockAt: 1,
    gifted: true,
  });
}

describe("F4.5 gifted / unknown-cost opening stock", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("A: stock 15 + cost 500 + no check is allowed", async () => {
    const id = await productRepository.create({
      name: "Comprado",
      category: "T",
      price: 1000,
      avgCost: 500,
      stock: 15,
      lowStockAt: 1,
    });
    const p = await productRepository.getById(id);
    expect(p?.stock).toBe(15);
    expect(p?.avgCost).toBe(500);
    const moves = await inventoryRepository.listMoves(id);
    expect(moves[0]?.reason).toBe("inicial");
    expect(moves[0]?.note).toBeUndefined();
  });

  it("B: stock 15 + cost 0 + no check is rejected", async () => {
    await expect(
      productRepository.create({
        name: "Olvido",
        category: "T",
        price: 1000,
        avgCost: 0,
        stock: 15,
        lowStockAt: 1,
      }),
    ).rejects.toThrow(INVENTORY_ERRORS.needCost);
  });

  it("C: stock 15 + cost 0 + gifted is allowed; no caja/Nequi/compra", async () => {
    const id = await createGifted(15, 1000);
    const p = await productRepository.getById(id);
    expect(p?.stock).toBe(15);
    expect(p?.avgCost).toBe(0);
    expect("gifted" in (p ?? {})).toBe(false);

    const moves = await inventoryRepository.listMoves(id);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.reason).toBe("inicial");
    expect(moves[0]?.delta).toBe(15);
    expect(moves[0]?.unitCost).toBe(0);
    expect(moves[0]?.note).toBe(GIFTED_STOCK_NOTE);

    expect(await getDb().cashMoves.count()).toBe(0);
    expect(await getDb().expenses.count()).toBe(0);
    const stats = await loadStats("hoy");
    expect(stats.inverti).toBe(0);
    expect(stats.gaste).toBe(0);
    expect(stats.ventas).toBe(0);
  });

  it("D: stock 0 + cost 0 + no check is allowed", async () => {
    const id = await productRepository.create({
      name: "Vacío",
      category: "T",
      price: 1000,
      avgCost: 0,
      stock: 0,
      lowStockAt: 1,
    });
    expect((await productRepository.getById(id))?.avgCost).toBe(0);
    expect(await inventoryRepository.listMoves(id)).toHaveLength(0);
  });

  it("E: stock 0 + cost 500 + no check is allowed", async () => {
    const id = await productRepository.create({
      name: "Sin stock",
      category: "T",
      price: 1000,
      avgCost: 500,
      stock: 0,
      lowStockAt: 1,
    });
    expect((await productRepository.getById(id))?.avgCost).toBe(500);
    expect(await inventoryRepository.listMoves(id)).toHaveLength(0);
  });

  it("gifted is a birth decision, not a permanent product type", async () => {
    const id = await createGifted(15, 1000);
    const saleId = await saleRepository.createSale({
      lines: [{ productId: id, qty: 3, unitPrice: 1000 }],
      paymentKind: "paid",
      amountReceived: 3000,
      method: "Efectivo",
      requestId: "gift-sale-3",
    });
    const lines = await saleRepository.linesForSale(saleId);
    expect(lines[0]?.unitCost).toBe(0);
    expect(lines[0]?.lineTotal).toBe(3000);

    const afterSale = await productRepository.getById(id);
    expect(afterSale?.stock).toBe(12);
    expect(afterSale?.avgCost).toBe(0);

    const stats = await loadStats("hoy");
    expect(stats.ventas).toBe(3000);
    expect(stats.ganancia).toBe(3000);

    await inventoryRepository.surtir({
      productId: id,
      qty: 10,
      unitCost: 500,
      totalCost: 5000,
      method: "Efectivo",
      requestId: "gift-surtir-10",
    });
    const restocked = await productRepository.getById(id);
    expect(restocked?.stock).toBe(22);
    expect(restocked?.avgCost).toBe(227);

    const sale2 = await saleRepository.createSale({
      lines: [{ productId: id, qty: 1, unitPrice: 1000 }],
      paymentKind: "paid",
      amountReceived: 1000,
      method: "Nequi",
      requestId: "gift-sale-after",
    });
    const later = await saleRepository.linesForSale(sale2);
    expect(later[0]?.unitCost).toBe(227);
    const firstAgain = await saleRepository.linesForSale(saleId);
    expect(firstAgain[0]?.unitCost).toBe(0);

    const cash = await cashRepository.listMoves();
    expect(cash.some((m) => m.kind === "compra" && m.amount === 5000)).toBe(
      true,
    );
    expect(cash.filter((m) => m.kind === "compra")).toHaveLength(1);
    expect(
      cash.some((m) => m.kind === "sale" && m.method === "Nequi"),
    ).toBe(true);
  });

  it("sell 5 then buy 10 at real cost; prior snapshot stays 0", async () => {
    const id = await createGifted(15, 1000);
    const first = await saleRepository.createSale({
      lines: [{ productId: id, qty: 5, unitPrice: 1000 }],
      paymentKind: "paid",
      amountReceived: 5000,
      method: "Efectivo",
      requestId: "gift-sale-5",
    });
    expect((await productRepository.getById(id))?.stock).toBe(10);

    await inventoryRepository.surtir({
      productId: id,
      qty: 10,
      unitCost: 500,
      totalCost: 5000,
      method: "Nequi",
      requestId: "gift-buy-10",
    });
    const p = await productRepository.getById(id);
    expect(p?.stock).toBe(20);
    expect(p?.avgCost).toBe(250);

    const second = await saleRepository.createSale({
      lines: [{ productId: id, qty: 2, unitPrice: 1000 }],
      paymentKind: "paid",
      amountReceived: 2000,
      method: "Efectivo",
      requestId: "gift-sale-2",
    });
    expect((await saleRepository.linesForSale(first))[0]?.unitCost).toBe(0);
    expect((await saleRepository.linesForSale(second))[0]?.unitCost).toBe(250);
    expect((await productRepository.getById(id))?.stock).toBe(18);

    const stats = await loadStats("hoy");
    expect(stats.ventas).toBe(7000);
    expect(stats.ganancia).toBe(5000 + (2000 - 500));
    expect(stats.inverti).toBe(5000);
  });
});
