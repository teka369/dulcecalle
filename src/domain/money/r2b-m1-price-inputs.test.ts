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

describe("Ronda 3 M-R3-1: ProductTile invalid price draft restores pre-edit price and blocks Cobrar on /ventas/nueva", () => {
  it("evaluateTilePriceDraft restores basePrice on invalid keystrokes ('12a', '1500,50', '200000000') instead of keeping intermediate prefix", async () => {
    const mod = (await import("@/domain/sale/validate")) as {
      evaluateTilePriceDraft?: (
        raw: string,
        basePrice: number,
      ) => { draft: string; priceError: string | null; invalid: boolean; effectiveDigits: string };
    };
    expect(typeof mod.evaluateTilePriceDraft).toBe("function");
    const evalDraft = mod.evaluateTilePriceDraft!;

    // Key-by-key "1" -> "12" -> "12a" from basePrice 1000
    expect(evalDraft("1", 1000)).toEqual({ draft: "1", priceError: null, invalid: false, effectiveDigits: "1" });
    expect(evalDraft("12", 1000)).toEqual({ draft: "12", priceError: null, invalid: false, effectiveDigits: "12" });
    const bad12a = evalDraft("12a", 1000);
    expect(bad12a.invalid).toBe(true);
    expect(bad12a.priceError).toMatch(/solo números/);
    expect(bad12a.effectiveDigits).toBe("1000");

    // Key-by-key "1500" -> "1500,50" from basePrice 1000
    const badDec = evalDraft("1500,50", 1000);
    expect(badDec.invalid).toBe(true);
    expect(badDec.priceError).toMatch(/sin coma ni decimales/);
    expect(badDec.effectiveDigits).toBe("1000");

    // Key-by-key "20000000" -> "200000000" from basePrice 1000
    expect(evalDraft("20000000", 1000)).toEqual({
      draft: "20000000",
      priceError: null,
      invalid: false,
      effectiveDigits: "20000000",
    });
    const badHuge = evalDraft("200000000", 1000);
    expect(badHuge.invalid).toBe(true);
    expect(badHuge.priceError).toMatch(/demasiado grande/);
    expect(badHuge.effectiveDigits).toBe("1000");

    // Fixing to "2.500" clears invalid and applies 2500
    expect(evalDraft("2.500", 1000)).toEqual({
      draft: "2.500",
      priceError: null,
      invalid: false,
      effectiveDigits: "2500",
    });
  });

  it("canProceedToCobrar and canRegister block checkout when a tile has priceError or total > MAX_COP_AMOUNT", async () => {
    const checkout = (await import("@/components/sale/checkout")) as {
      CHECKOUT_DEFAULTS: import("@/components/sale/checkout").CheckoutState;
      canRegister: typeof import("@/components/sale/checkout").canRegister;
      canProceedToCobrar?: (total: number, hasInvalidPrice?: boolean) => boolean;
    };
    expect(typeof checkout.canProceedToCobrar).toBe("function");
    expect(checkout.canProceedToCobrar!(1000, false)).toBe(true);
    expect(checkout.canProceedToCobrar!(1000, true)).toBe(false);
    expect(checkout.canProceedToCobrar!(0, false)).toBe(false);
    expect(checkout.canProceedToCobrar!(MAX_COP_AMOUNT, false)).toBe(true);
    expect(checkout.canProceedToCobrar!(MAX_COP_AMOUNT + 1, false)).toBe(false);
    expect(checkout.canRegister(checkout.CHECKOUT_DEFAULTS, MAX_COP_AMOUNT + 1, 2)).toBe(false);

    const tileSrc = readFileSync("src/components/product/ProductTile.tsx", "utf8");
    const nuevaVentaSrc = readFileSync("src/app/ventas/nueva/page.tsx", "utf8");
    expect(tileSrc).toContain("evaluateTilePriceDraft");
    expect(tileSrc).toContain("onPriceInvalidChange");
    expect(nuevaVentaSrc).toContain("canProceedToCobrar");
    expect(nuevaVentaSrc).toContain("onPriceInvalidChange");
  });
});
