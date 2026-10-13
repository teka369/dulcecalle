import { describe, expect, it } from "vitest";
import type { DebtEntry } from "@/domain/debt/statement";
import { abonoView, filterCustomers, porCobrar, shortDateTime, sortCustomers, statementRow } from "./clientes";

const people = [
  { id: "a", name: "Luis", code: "C-0007", debt: 0 },
  { id: "b", name: "Ana", code: "C-0012", debt: 30000 },
  { id: "c", name: "Beto", code: "C-0003", debt: 32000 },
  { id: "d", name: "Carla", code: "C-0001", debt: 0 },
];

describe("clientes list", () => {
  it("POR COBRAR sums only debt>0 and counts debtors", () => {
    expect(porCobrar(people)).toEqual({ total: 62000, count: 2 });
  });
  it("debtors first by desc debt, then alphabetical", () => {
    expect(sortCustomers(people).map((c) => c.id)).toEqual(["c", "b", "d", "a"]);
  });
  it("Deben segment and search by name or code", () => {
    expect(filterCustomers(people, "", "deben").map((c) => c.id)).toEqual(["c", "b"]);
    expect(filterCustomers(people, "c-0007", "todos").map((c) => c.id)).toEqual(["a"]);
    expect(filterCustomers(people, "luis", "deben")).toEqual([]);
  });
});

describe("statement rows: fiado balance ≠ recibido", () => {
  const sale: DebtEntry = {
    kind: "parcial",
    id: "sale-9",
    saleId: 9,
    fiadoIndex: 4,
    createdAt: 0,
    lines: [],
    saleTotal: 50000,
    amountReceived: 20000,
    credit: 30000,
    runningBalance: 30000,
  } as DebtEntry;
  it("charges the credit, not the sale total nor what was received", () => {
    const r = statementRow(sale);
    expect(r.amount).toBe(30000);
    expect(r.amount).not.toBe(20000);
    expect(r.amount).not.toBe(50000);
    expect(r).toMatchObject({ sign: "+", tone: "danger", word: "Cargo", href: "/ventas/9" });
  });
  it("abono and devolución subtract with a word, not colour only", () => {
    const ab = statementRow({ kind: "abono", id: "p", createdAt: 0, amount: 10000, method: "Nequi", runningBalance: 0 } as DebtEntry);
    expect(ab).toMatchObject({ sign: "−", tone: "ok", word: "Abono", label: "Abono · Nequi", amount: 10000 });
    const dv = statementRow({ kind: "devolucion", id: "r", createdAt: 0, amount: 5000, runningBalance: 0 } as DebtEntry);
    expect(dv.sign).toBe("−");
  });
});

describe("abono with Efectivo | Nequi", () => {
  it.each(["Efectivo", "Nequi"] as const)("%s is valid and leaves remaining", (m) => {
    const v = abonoView(30000, "10000", m);
    expect(v.valid).toBe(true);
    expect(v.method).toBe(m);
    expect(v.remaining).toBe(20000);
    expect(v.remainingText).toMatch(/^Queda debiendo/);
  });
  it("rejects other methods, over-debt and empty", () => {
    expect(abonoView(30000, "10000", "Tarjeta" as never).valid).toBe(false);
    expect(abonoView(30000, "40000", "Efectivo").valid).toBe(false);
    expect(abonoView(30000, "", "Nequi").valid).toBe(false);
  });
  it("Todo chip equals debt; paying all leaves 0", () => {
    const v = abonoView(30000, "30000", "Efectivo");
    expect(v.fullChip).toBe("30000");
    expect(v.remaining).toBe(0);
    expect(v.remainingText).toMatch(/^Queda debiendo \$\s?0$/);
    expect(v.remainingText).not.toMatch(/Queda en/);
    expect(abonoView(0, "", "Efectivo").fullChip).toBeNull();
  });
});

describe("short statement dates (360px)", () => {
  it("formats as «13 oct · 10:05» in Bogotá", () => {
    // 2026-10-13 15:05Z = 10:05 Bogotá
    expect(shortDateTime(Date.UTC(2026, 9, 13, 15, 5))).toBe("13 oct · 10:05");
    // midnight Bogotá must read 00:xx, never 24:xx; month without trailing dot
    expect(shortDateTime(Date.UTC(2026, 8, 6, 5, 7))).toBe("6 sept · 00:07");
  });
});
