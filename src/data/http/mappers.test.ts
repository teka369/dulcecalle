import { describe, expect, it } from "vitest";
import { asCopJson, asDateKey, asIsoEpoch, mapProduct, mapSale } from "./mappers";

describe("HTTP COP / date mappers", () => {
  it("accepts integer COP including 0, 500, 45000, 1000000", () => {
    for (const n of [0, 500, 1500, 45000, 1000000]) {
      expect(asCopJson(n, "x")).toBe(n);
    }
  });

  it("rejects floats and non-numbers", () => {
    expect(() => asCopJson(1.5, "x")).toThrow(/integer COP/);
    expect(() => asCopJson("500", "x")).toThrow(/integer COP/);
    expect(() => asCopJson(undefined, "x")).toThrow(/integer COP/);
  });

  it("keeps occurredOn as America/Bogota date key, createdAt as UTC epoch", () => {
    expect(asDateKey("2026-09-17")).toBe("2026-09-17");
    expect(asIsoEpoch("2026-09-18T04:30:00.000Z")).toBe(
      Date.parse("2026-09-18T04:30:00.000Z"),
    );
  });

  it("maps product/sale snapshots without computing totals", () => {
    const p = mapProduct({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Galleta",
      category: "General",
      price: 1000,
      avgCost: 0,
      stock: 15,
      lowStockAt: 5,
      archivedAt: null,
      createdAt: "2026-09-17T12:00:00.000Z",
    });
    expect(p.price).toBe(1000);
    expect(p.avgCost).toBe(0);

    const s = mapSale({
      id: "22222222-2222-4222-8222-222222222222",
      customerId: null,
      paymentKind: "paid",
      method: "Efectivo",
      saleTotal: 3000,
      amountReceived: 3000,
      credit: 0,
      note: null,
      occurredOn: "2026-09-17",
      createdAt: "2026-09-17T12:00:00.000Z",
      lines: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          productId: p.id,
          productName: "Galleta",
          qty: 3,
          unitPrice: 1000,
          unitCost: 0,
          lineTotal: 3000,
        },
      ],
    });
    expect(s.saleTotal).toBe(3000);
    expect(s.lines[0].unitCost).toBe(0);
    expect(s.occurredOn).toBe("2026-09-17");
  });
});
