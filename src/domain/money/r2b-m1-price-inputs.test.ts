import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveSurtirCost, validatePreparationForm, validateSurtirForm } from "@/domain/inventory/validate";
import { parseSaleUnitPrice } from "@/domain/sale/validate";
import { MAX_COP_AMOUNT } from "./limits";

describe("R2-B M1: unit-cost, editar-precio-prod, and sale unit price enforce AmountField rules and MAX_COP_AMOUNT", () => {
  it("resolveSurtirCost and validateSurtirForm reject unitCost, totalCost, or unit*qty above MAX_COP_AMOUNT and decimals/letters", () => {
    expect(resolveSurtirCost({ qty: 1, unitCostRaw: String(MAX_COP_AMOUNT + 1), totalCostRaw: "" })).toHaveProperty("error");
    expect(resolveSurtirCost({ qty: 1, unitCostRaw: "", totalCostRaw: String(MAX_COP_AMOUNT + 1) })).toHaveProperty("error");
    // 60.000.000 * 2 = 120.000.000 > MAX_COP_AMOUNT
    expect(resolveSurtirCost({ qty: 2, unitCostRaw: "60000000", totalCostRaw: "" })).toHaveProperty("error");
    expect(validateSurtirForm({ qtyRaw: "2", unitCostRaw: "60000000", totalCostRaw: "120000000", method: "Efectivo" })).toHaveProperty("error");
    expect(resolveSurtirCost({ qty: 1, unitCostRaw: "1500,50", totalCostRaw: "" })).toHaveProperty("error");
    expect(resolveSurtirCost({ qty: 1, unitCostRaw: "12a", totalCostRaw: "" })).toHaveProperty("error");
    expect(resolveSurtirCost({ qty: 2, unitCostRaw: "50000000", totalCostRaw: "" })).toEqual({
      unitCost: 50_000_000,
      totalCost: 100_000_000,
    });
  });

  it("validatePreparationForm rejects unitCost above MAX_COP_AMOUNT or with decimals/letters", () => {
    const src = "11111111-1111-4111-8111-111111111111";
    const dst = "22222222-2222-4222-8222-222222222222";
    expect(validatePreparationForm({ sourceId: src, targetId: dst, qtyRaw: "1", unitCostRaw: String(MAX_COP_AMOUNT + 1) })).toHaveProperty("error");
    expect(validatePreparationForm({ sourceId: src, targetId: dst, qtyRaw: "1", unitCostRaw: "1500,50" })).toHaveProperty("error");
    expect(validatePreparationForm({ sourceId: src, targetId: dst, qtyRaw: "1", unitCostRaw: "12a" })).toHaveProperty("error");
  });

  it("parseSaleUnitPrice rejects decimals ('1500,50'), letters ('12a'), and values > MAX_COP_AMOUNT", () => {
    expect(parseSaleUnitPrice("1500,50", 1000)).toHaveProperty("error");
    expect(parseSaleUnitPrice("12a", 1000)).toHaveProperty("error");
    expect(parseSaleUnitPrice(String(MAX_COP_AMOUNT + 1), 1000)).toHaveProperty("error");
    expect(parseSaleUnitPrice("1.500", 1000)).toEqual({ unitPrice: 1500 });
    expect(parseSaleUnitPrice("", 1000)).toEqual({ unitPrice: 1000 });
  });

  it("surtir, producto edit, and nueva venta do not silently strip non-digits with .replace(/\\D/g, '') on price/cost inputs", () => {
    const surtirPage = readFileSync("src/app/inventario/[id]/surtir/page.tsx", "utf8");
    const prodPage = readFileSync("src/app/inventario/[id]/page.tsx", "utf8");
    const nuevaVentaPage = readFileSync("src/app/ventas/nueva/page.tsx", "utf8");
    expect(surtirPage).toContain('label="Costo unitario"');
    expect(prodPage).not.toContain('setEditPrice(e.target.value.replace(/\\D/g, ""))');
    expect(nuevaVentaPage).not.toContain('const digits = raw.replace(/\\D/g, "");\n    const parsed = parseSaleUnitPrice');
  });
});
