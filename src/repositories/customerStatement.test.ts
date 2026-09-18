import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "@/storage/db";
import { customerRepository } from "./customerRepository";
import { saleRepository } from "./saleRepository";
import { productRepository } from "./productRepository";

describe("customer debt statement from Dexie", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("renders an initial debt with no product lines", async () => {
    const customerId = await customerRepository.create({ name: "Vecina" });
    await customerRepository.recordInitialDebt({
      customerId,
      amount: 45_200,
      note: "De antes del sistema",
      requestId: "inicial-real",
    });
    const statement = await customerRepository.getStatement(customerId);
    expect(statement?.total).toBe(45_200);
    expect(statement?.entries).toHaveLength(1);
    expect(statement?.entries[0]?.kind).toBe("inicial");
    expect(statement?.entries[0] && "lines" in statement.entries[0]).toBe(
      false,
    );
  });

  it("shows products from a credit sale", async () => {
    const customerId = await customerRepository.create({ name: "Juan" });
    const productId = await productRepository.create({
      name: "Galleta",
      category: "General",
      price: 2500,
      avgCost: 800,
      stock: 10,
      lowStockAt: 1,
    });
    const saleId = await saleRepository.createSale({
      customerId,
      paymentKind: "credit",
      amountReceived: 0,
      lines: [{ productId, qty: 2, unitPrice: 2500 }],
      requestId: "sale-fiada-1",
    });
    const statement = await customerRepository.getStatement(customerId);
    expect(saleId).toBeGreaterThan(0);
    expect(statement?.total).toBe(5_000);
    const fiada = statement?.entries.find((e) => e.kind === "fiada");
    expect(fiada?.kind).toBe("fiada");
    if (fiada?.kind !== "fiada") throw new Error("expected fiada");
    expect(fiada.lines).toEqual([
      {
        productName: "Galleta",
        qty: 2,
        unitPrice: 2500,
        lineTotal: 5000,
      },
    ]);
  });
});
