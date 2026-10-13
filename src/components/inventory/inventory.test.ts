import { describe, expect, it } from "vitest";
import {
  inventoryCounts,
  inventoryValue,
  isLowStock,
  isOutOfStock,
  moveDelta,
  clampQty,
  dmy,
  splitByStock,
  stepQty,
  stockAfter,
  unitCostHint,
} from "./inventory";

const list = [
  { id: "1", name: "Gomitas", stock: 3, lowStockAt: 5 },
  { id: "2", name: "Jet", stock: 40, lowStockAt: 5 },
  { id: "3", name: "Chicle", stock: 0, lowStockAt: 2 },
  { id: "4", name: "Mani", stock: 5, lowStockAt: 5 },
];

describe("low stock", () => {
  it("stock ≤ umbral is low (boundary included), 0 is agotado", () => {
    expect(isLowStock(list[0])).toBe(true);
    expect(isLowStock(list[3])).toBe(true);
    expect(isLowStock(list[1])).toBe(false);
    expect(isOutOfStock(list[2])).toBe(true);
  });
  it("hero counts and STOCK BAJO / TODOS split with search", () => {
    expect(inventoryCounts(list)).toEqual({ products: 4, low: 3 });
    const s = splitByStock(list, "");
    expect(s.low.map((p) => p.id)).toEqual(["1", "3", "4"]);
    expect(s.rest.map((p) => p.id)).toEqual(["2"]);
    expect(splitByStock(list, "jE").rest.map((p) => p.id)).toEqual(["2"]);
    expect(splitByStock(list, "zzz")).toEqual({ low: [], rest: [] });
  });
});

describe("stock ≠ inventory value", () => {
  it("sellable value is stock × avgCost, not units", () => {
    const p = { stock: 40, avgCost: 750, sellable: true };
    expect(inventoryValue(p)).toBe(30000);
    expect(inventoryValue(p)).not.toBe(p.stock);
  });
  it("no cost → value 0 even with units", () => {
    expect(inventoryValue({ stock: 12, avgCost: 0, sellable: true })).toBe(0);
  });
  it("insumo uses the remaining lot value as-is", () => {
    expect(inventoryValue({ stock: 2, avgCost: 18000, sellable: false })).toBe(18000);
  });
});

describe("form helpers", () => {
  it("Quedará X u. for surtir (+) and mermas (−)", () => {
    expect(stockAfter(3, "10", 1)).toBe(13);
    expect(stockAfter(3, "2", -1)).toBe(1);
    expect(stockAfter(3, "", -1)).toBeNull();
    expect(stockAfter(3, "0", 1)).toBeNull();
  });
  it("stepper floors at 0 and caps at stock", () => {
    expect(stepQty("", 1)).toBe("1");
    expect(stepQty("1", -1)).toBe("");
    expect(stepQty("3", 1, 3)).toBe("3");
  });
  it("unit cost hint = total / qty rounded", () => {
    expect(unitCostHint("10000", "3")).toBe(3333);
    expect(unitCostHint("10000", "")).toBeNull();
  });
  it("move delta carries a word", () => {
    expect(moveDelta(5)).toEqual({ sign: "+", qty: 5, word: "Entra", tone: "ok" });
    expect(moveDelta(-2)).toEqual({ sign: "−", qty: 2, word: "Sale", tone: "danger" });
  });
});

describe("typed qty is capped at stock", () => {
  it("never lets «Quedará» go negative", () => {
    expect(clampQty("9", 5)).toBe("5");
    expect(stockAfter(5, clampQty("9", 5), -1)).toBe(0);
    expect(clampQty("3a", 5)).toBe("3");
    expect(clampQty("40", undefined)).toBe("40");
  });
});

describe("preparation dates", () => {
  it("dd/mm/aaaa", () => {
    expect(dmy("2026-10-13")).toBe("13/10/2026");
    expect(dmy("")).toBe("");
  });
});

import { moveMeta } from "./inventory";
describe("moveMeta (Historial)", () => {
  it("uses dd/mm/aaaa like Preparaciones", () => {
    expect(moveMeta({ note: "Surtido", occurredOn: "2026-10-13" })).toBe("Surtido · 13/10/2026");
    expect(moveMeta({ note: null, occurredOn: "2026-01-05T10:00:00Z" })).toBe("05/01/2026");
  });
});
