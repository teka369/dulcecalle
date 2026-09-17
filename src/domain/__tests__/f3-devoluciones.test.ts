import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests, __reopenDbForTests, getDb } from "@/storage/db";
import { CASH_ERRORS, localDateKey } from "@/domain/cash";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { RETURN_ERRORS } from "@/domain/sale/returns";
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

describe("F3 devoluciones", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  async function seedPaid(method: "Efectivo" | "Nequi" = "Efectivo") {
    const productId = await productRepository.create({
      name: "Chocolate",
      category: "Chocolates",
      price: 2000,
      avgCost: 800,
      stock: 10,
      lowStockAt: 2,
    });
    await cashRepository.openSession(50_000);
    const saleId = await saleRepository.createSale({
      lines: [{ productId, qty: 2 }],
      paymentKind: "paid",
      amountReceived: 4_000,
      method,
    });
    const lines = await saleRepository.linesForSale(saleId);
    return { productId, saleId, line: lines[0]! };
  }

  it("partial return restores stock, keeps the sale, refunds cash", async () => {
    const { productId, saleId, line } = await seedPaid("Efectivo");
    const id = await saleRepository.createReturn({
      saleId,
      lines: [{ saleLineId: line.id!, qty: 1 }],
      requestId: "dev-p",
    });
    expect(id).toBeTruthy();

    const sale = await saleRepository.getById(saleId);
    expect(sale?.saleTotal).toBe(4_000);
    expect((await productRepository.getById(productId))?.stock).toBe(9);

    const moves = await getDb().cashMoves.toArray();
    const refund = moves.find((m) => m.kind === "devolucion");
    expect(refund?.amount).toBe(2_000);
    expect(refund?.method).toBe("Efectivo");
    expect(refund?.direction).toBe("out");
    expect(await metricVentas()).toBe(4_000);
    expect(await metricCaja()).toBe(2_000); // 4000 in − 2000 out (no opening in balance)
  });

  it("total return zeros remaining qty", async () => {
    const { saleId, line, productId } = await seedPaid();
    await saleRepository.createReturn({
      saleId,
      lines: [{ saleLineId: line.id!, qty: 2 }],
      requestId: "dev-t",
    });
    const row = await saleRepository.getReturnable(saleId);
    expect(row?.remainingValue).toBe(0);
    expect((await productRepository.getById(productId))?.stock).toBe(10);
  });

  it("Nequi refund stays Nequi, not Efectivo", async () => {
    const { saleId, line } = await seedPaid("Nequi");
    await saleRepository.createReturn({
      saleId,
      lines: [{ saleLineId: line.id!, qty: 1 }],
    });
    const refund = (await getDb().cashMoves.toArray()).find(
      (m) => m.kind === "devolucion",
    );
    expect(refund?.method).toBe("Nequi");
    const buckets = await cashRepository.expectedBuckets();
    expect(buckets.nequi).toBe(2_000); // 4000 in − 2000 out
    expect(buckets.efectivo).toBe(50_000);
  });

  it("credit return lowers debt and does not hit caja", async () => {
    const productId = await productRepository.create({
      name: "Gomita",
      category: "Gomitas",
      price: 1000,
      avgCost: 400,
      stock: 10,
      lowStockAt: 2,
    });
    const customerId = await customerRepository.create({ name: "Ana" });
    await customerRepository.recordInitialDebt({
      customerId,
      amount: 15_000,
      requestId: "ini",
    });
    const saleId = await saleRepository.createSale({
      lines: [{ productId, qty: 5 }],
      paymentKind: "credit",
      customerId,
      amountReceived: 0,
    });
    expect(await metricFiadoOutstanding()).toBe(20_000);
    const line = (await saleRepository.linesForSale(saleId))[0]!;
    await saleRepository.createReturn({
      saleId,
      lines: [{ saleLineId: line.id!, qty: 3 }],
    });
    expect((await customerRepository.getById(customerId))?.debt).toBe(17_000);
    expect(await getDb().cashMoves.where("kind").equals("devolucion").count()).toBe(
      0,
    );
    expect(await metricCaja()).toBe(0);
  });

  it("uses historical snapshots, not current catalog", async () => {
    const { productId, saleId, line } = await seedPaid();
    await productRepository.update(productId, { price: 9_000, avgCost: 10 });
    await saleRepository.createReturn({
      saleId,
      lines: [{ saleLineId: line.id!, qty: 1 }],
    });
    const rl = (await getDb().saleReturnLines.toArray())[0]!;
    expect(rl.unitPrice).toBe(2_000);
    expect(rl.unitCost).toBe(800);
    const stats = await loadStats("hoy");
    expect(stats.ganancia).toBe(1_200); // one unit remaining: 2000−800
    expect(stats.devoluciones).toBe(2_000);
    expect(stats.ventas).toBe(4_000);
  });

  it("same requestId does not double; over-return is rejected", async () => {
    const { saleId, line, productId } = await seedPaid();
    const a = await saleRepository.createReturn({
      saleId,
      lines: [{ saleLineId: line.id!, qty: 1 }],
      requestId: "same",
    });
    const b = await saleRepository.createReturn({
      saleId,
      lines: [{ saleLineId: line.id!, qty: 1 }],
      requestId: "same",
    });
    expect(b).toBe(a);
    expect((await productRepository.getById(productId))?.stock).toBe(9);

    await expect(
      saleRepository.createReturn({
        saleId,
        lines: [{ saleLineId: line.id!, qty: 2 }],
        requestId: "over",
      }),
    ).rejects.toThrow(RETURN_ERRORS.exceeds);
  });

  it("rejects missing sale, foreign line, bad qty, closed day", async () => {
    const { saleId, line } = await seedPaid();
    await expect(
      saleRepository.createReturn({ saleId: 9999, lines: [{ saleLineId: 1, qty: 1 }] }),
    ).rejects.toThrow(RETURN_ERRORS.saleNotFound);
    await expect(
      saleRepository.createReturn({
        saleId,
        lines: [{ saleLineId: 9999, qty: 1 }],
      }),
    ).rejects.toThrow(RETURN_ERRORS.lineNotFound);
    await expect(
      saleRepository.createReturn({
        saleId,
        lines: [{ saleLineId: line.id!, qty: 0 }],
      }),
    ).rejects.toThrow(RETURN_ERRORS.badQty);
    await expect(
      saleRepository.createReturn({
        saleId,
        lines: [{ saleLineId: line.id!, qty: Number.NaN }],
      }),
    ).rejects.toThrow(RETURN_ERRORS.badQty);

    const session = await cashRepository.getTodaySession();
    await cashRepository.closeSession(session!.id!, 54_000);
    await expect(
      saleRepository.createReturn({
        saleId,
        lines: [{ saleLineId: line.id!, qty: 1 }],
      }),
    ).rejects.toThrow(CASH_ERRORS.dayClosed);
  });

  it("persists after reload", async () => {
    const { saleId, line, productId } = await seedPaid();
    await saleRepository.createReturn({
      saleId,
      lines: [{ saleLineId: line.id!, qty: 1 }],
    });
    __reopenDbForTests();
    expect((await productRepository.getById(productId))?.stock).toBe(9);
    expect((await saleRepository.getReturnable(saleId))?.lines[0]?.remaining).toBe(
      1,
    );
    expect(await metricRecibido()).toBe(4_000);
  });
});

describe("F3 surtir date + product cost", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("rejects surtir dated on another open day", async () => {
    const productId = await productRepository.create({
      name: "X",
      category: "T",
      price: 1000,
      avgCost: 400,
      stock: 1,
      lowStockAt: 1,
    });
    const y = new Date();
    y.setDate(y.getDate() - 1);
    y.setHours(12, 0, 0, 0);
    await getDb().cashSessions.add({
      localDate: localDateKey(y.getTime()),
      openedAt: y.getTime(),
      closedAt: null,
      openingFloat: 0,
      closingCount: null,
    });
    await cashRepository.openSession(0);
    await expect(
      inventoryRepository.surtir({
        productId,
        qty: 1,
        unitCost: 100,
        totalCost: 100,
        method: "Efectivo",
        createdAt: y.getTime(),
      }),
    ).rejects.toThrow(INVENTORY_ERRORS.surtirTodayOnly);
    expect((await productRepository.getById(productId))?.stock).toBe(1);
  });

  it("rejects initial stock with cost 0; allows stock 0", async () => {
    await expect(
      productRepository.create({
        name: "Sin costo",
        category: "T",
        price: 2000,
        avgCost: 0,
        stock: 10,
        lowStockAt: 1,
      }),
    ).rejects.toThrow(INVENTORY_ERRORS.needCost);
    const id = await productRepository.create({
      name: "Vacío",
      category: "T",
      price: 2000,
      avgCost: 0,
      stock: 0,
      lowStockAt: 1,
    });
    expect(id).toBeTruthy();
  });
});
