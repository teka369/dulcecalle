import { describe, expect, it } from "vitest";
import {
  INVENTORY_ERRORS,
  parseQtyRaw,
  resolveSurtirCost,
  validateMotivo,
  validateShrinkQty,
  validateSurtirForm,
} from "./validate";

describe("inventory validate (Tanda 3)", () => {
  it("qty empty / not positive", () => {
    expect(parseQtyRaw("")).toEqual({ error: INVENTORY_ERRORS.emptyQty });
    expect(parseQtyRaw("0")).toEqual({ error: INVENTORY_ERRORS.notPositive });
    expect(parseQtyRaw("-1")).toEqual({ error: INVENTORY_ERRORS.notPositive });
    expect(parseQtyRaw("3")).toEqual({ qty: 3 });
  });

  it("shrink rejects overstock", () => {
    expect(validateShrinkQty("5", 4)).toEqual({
      error: INVENTORY_ERRORS.insufficientStock,
    });
    expect(validateShrinkQty("4", 4)).toEqual({ qty: 4 });
  });

  it("motivo required", () => {
    expect(validateMotivo("")).toBe(INVENTORY_ERRORS.emptyMotivo);
    expect(validateMotivo("  ")).toBe(INVENTORY_ERRORS.emptyMotivo);
    expect(validateMotivo("se rompió")).toBeNull();
  });

  it("cost: only total → round unit", () => {
    expect(resolveSurtirCost({ qty: 3, unitCostRaw: "", totalCostRaw: "1000" })).toEqual({
      unitCost: 333,
      totalCost: 1000,
    });
  });

  it("cost: only unit → total = unit*qty", () => {
    expect(resolveSurtirCost({ qty: 10, unitCostRaw: "600", totalCostRaw: "" })).toEqual({
      unitCost: 600,
      totalCost: 6000,
    });
  });

  it("surtir form requires pay method", () => {
    const r = validateSurtirForm({
      qtyRaw: "2",
      unitCostRaw: "100",
      totalCostRaw: "",
      method: null,
    });
    expect(r).toEqual({ error: INVENTORY_ERRORS.noMethod });
  });
});
