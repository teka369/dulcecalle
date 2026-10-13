import { describe, expect, it } from "vitest";
import { closeDifference, dineroCells, expectedAfter, moveSign, summarizeMoves, sumAmounts } from "./cash";

const stats = {
  ventas: 100000,
  ventasCount: 4,
  devoluciones: 5000,
  recibido: 70000,
  recibidoEfectivo: 50000,
  recibidoNequi: 20000,
  porCobrar: 30000,
  gaste: 8000,
  inverti: 40000,
  valorInventario: 250000,
  stockBajo: 2,
  ganancia: 35000,
};

describe("metrics stay separate (caja ≠ ventas ≠ recibido ≠ ganancia)", () => {
  it("each DINERO cell maps to its own field", () => {
    const cells = Object.fromEntries(dineroCells(stats).map((c) => [c.key, c.value]));
    expect(cells).toEqual({ recibido: 70000, porCobrar: 30000, gaste: 8000, inverti: 40000 });
    expect(cells.recibido).not.toBe(stats.ventas);
    expect(cells.recibido).not.toBe(stats.ganancia);
  });
  it("captions never merge concepts", () => {
    for (const c of dineroCells(stats)) expect(c.caption.length).toBeGreaterThan(0);
    expect(new Set(dineroCells(stats).map((c) => c.label)).size).toBe(4);
  });
  it("caja entradas come from cash moves, not from ventas or ganancia", () => {
    const moves = [
      { kind: "sale", method: "Efectivo", amount: 20000, direction: "in" },
      { kind: "expense", method: "Efectivo", amount: 3000, direction: "out" },
    ];
    const s = summarizeMoves(moves);
    expect(s).toEqual({ entradas: 20000, salidas: 3000, neto: 17000 });
    expect(s.entradas).not.toBe(stats.ventas);
    expect(s.neto).not.toBe(stats.ganancia);
  });
});

describe("gasto / retiro / aporte affect caja correctly", () => {
  const base = { efectivo: 95000, nequi: 10000, total: 105000 };
  it("aporte adds to the chosen bucket", () => {
    expect(expectedAfter(base, "aporte", "Efectivo", 5000)).toEqual({ efectivo: 100000, nequi: 10000, total: 110000 });
    expect(expectedAfter(base, "aporte", "Nequi", 5000)).toEqual({ efectivo: 95000, nequi: 15000, total: 110000 });
  });
  it("retiro and gasto subtract from the chosen bucket only", () => {
    expect(expectedAfter(base, "retiro", "Efectivo", 15000).efectivo).toBe(80000);
    expect(expectedAfter(base, "gasto", "Nequi", 4000)).toEqual({ efectivo: 95000, nequi: 6000, total: 101000 });
  });
  it("moves carry a sign and a word", () => {
    expect(moveSign({ direction: "in" })).toEqual({ sign: "+", word: "Entra", tone: "ok" });
    expect(moveSign({ direction: "out" }).word).toBe("Sale");
  });
});

describe("cerrar caja difference", () => {
  it("Sobra / Falta / Cuadra against expected efectivo", () => {
    expect(closeDifference(100000, 95000)).toMatchObject({ word: "Sobra", abs: 5000 });
    expect(closeDifference(90000, 95000)).toMatchObject({ word: "Falta", abs: 5000, tone: "danger" });
    expect(closeDifference(95000, 95000)).toMatchObject({ word: "Cuadra", diff: 0 });
    expect(closeDifference(null, 95000)).toBeNull();
  });
  it("gastos total listado", () => {
    expect(sumAmounts([{ amount: 3000 }, { amount: 4500 }])).toBe(7500);
  });
});

import { shortDay } from "./cash";
describe("shortDay (§3.22)", () => {
  it("formats local dates as «mar 13 oct»", () => {
    expect(shortDay("2026-10-13")).toBe("mar 13 oct");
    expect(shortDay("2026-01-04")).toBe("dom 4 ene");
    expect(shortDay("bad")).toBe("bad");
  });
});

import { cashOfflineView } from "./cash";
describe("cashOfflineView (S5: no duplicate Abrir caja offline)", () => {
  it("online is always online", () => {
    expect(cashOfflineView({ online: true, preparedAt: null, hasLocalData: false })).toBe("online");
  });
  it("offline without prep nor local data => offline-nocache (no Abrir caja)", () => {
    expect(cashOfflineView({ online: false, preparedAt: null, hasLocalData: false })).toBe("offline-nocache");
  });
  it("offline with prepared snapshot or local data => offline-cache", () => {
    expect(cashOfflineView({ online: false, preparedAt: 1, hasLocalData: false })).toBe("offline-cache");
    expect(cashOfflineView({ online: false, preparedAt: null, hasLocalData: true })).toBe("offline-cache");
  });
});

import { kindLabel as kl } from "./cash";
describe("kindLabel readable (S1)", () => {
  it("maps raw lowercase kinds", () => {
    expect(kl("abono")).toBe("Abono");
    expect(kl("gasto")).toBe("Gasto");
    expect(kl("venta")).toBe("Venta");
    expect(kl("otro_tipo")).toBe("Otro tipo");
  });
});
