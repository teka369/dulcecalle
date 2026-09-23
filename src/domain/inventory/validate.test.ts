import { describe, expect, it } from "vitest";
import {
  INVENTORY_ERRORS,
  parseQtyRaw,
  resolveSurtirCost,
  validateMotivo,
  validatePreparationForm,
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

  it("cost: both contradict → total wins, unit rounded", () => {
    expect(
      resolveSurtirCost({ qty: 10, unitCostRaw: "500", totalCostRaw: "7000" }),
    ).toEqual({ unitCost: 700, totalCost: 7000 });
  });

  it("cost: both consistent stay as-is", () => {
    expect(
      resolveSurtirCost({ qty: 10, unitCostRaw: "500", totalCostRaw: "5000" }),
    ).toEqual({ unitCost: 500, totalCost: 5000 });
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

  it("preparation form validates parties, qty and explicit cost", () => {
    const base = {
      sourceId: "11111111-1111-4111-8111-111111111111",
      targetId: "22222222-2222-4222-8222-222222222222",
      qtyRaw: "10",
      unitCostRaw: "200",
    };
    expect(validatePreparationForm(base)).toEqual({
      sourceId: base.sourceId,
      targetId: base.targetId,
      qty: 10,
      unitCost: 200,
    });
    // Empty cost = pending, never an invented proration.
    expect(validatePreparationForm({ ...base, unitCostRaw: "" })).toMatchObject({
      qty: 10,
      unitCost: 0,
    });
    expect(
      validatePreparationForm({ ...base, sourceId: base.targetId }),
    ).toEqual({ error: INVENTORY_ERRORS.sameProduct });
    expect(validatePreparationForm({ ...base, targetId: "" })).toEqual({
      error: INVENTORY_ERRORS.emptyTarget,
    });
    expect(validatePreparationForm({ ...base, sourceId: "" })).toEqual({
      error: INVENTORY_ERRORS.emptyCombo,
    });
    expect(validatePreparationForm({ ...base, qtyRaw: "0" })).toEqual({
      error: INVENTORY_ERRORS.notPositive,
    });
    expect(validatePreparationForm({ ...base, unitCostRaw: "abc" })).toEqual({
      error: INVENTORY_ERRORS.badCost,
    });
  });
});
