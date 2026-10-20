import { describe, expect, it } from "vitest";
import { correctionFor } from "./sync-tray";

/** loop/v1 conflict UI: «Corregir» target per rejected op (prefilled where feasible). */
describe("correctionFor", () => {
  it("cash aporte/retiro and gasto open their form with the amount (and category)", () => {
    expect(correctionFor({ entity: "cashMove", operation: "create", payload: { kind: "aporte", amount: 4700, method: "Efectivo" } }).href).toBe("/mas/caja/aporte?monto=4700");
    expect(correctionFor({ entity: "cashMove", operation: "create", payload: { kind: "retiro", amount: 900 } }).href).toBe("/mas/caja/retiro?monto=900");
    expect(correctionFor({ entity: "expense", operation: "create", payload: { amount: 1200, category: "Bolsas" } }).href).toBe("/mas/gastos/nuevo?monto=1200&categoria=Bolsas");
  });
  it("stock and customer ops open the product/customer form with qty/amount", () => {
    const P = "00000000-0000-4000-8000-000000000001";
    const C = "00000000-0000-4000-8000-000000000002";
    expect(correctionFor({ entity: "stockMove", operation: "surtir", payload: { productId: P, qty: 5 } }).href).toBe(`/inventario/${P}/surtir?cantidad=5`);
    expect(correctionFor({ entity: "stockMove", operation: "shrink", payload: { productId: P, qty: 2, reason: "regalar" } }).href).toBe(`/inventario/${P}/regalo?cantidad=2`);
    expect(correctionFor({ entity: "customerPayment", operation: "pay", payload: { customerId: C, amount: 3000 } }).href).toBe(`/clientes/${C}/abono?monto=3000`);
    expect(correctionFor({ entity: "initialDebt", operation: "create", payload: { customerId: C, amount: 8000 } }).href).toBe(`/clientes/${C}/deuda-inicial?monto=8000`);
  });
  it("a sale cannot be prefilled: navigates and explains; unknown ops only explain", () => {
    const sale = correctionFor({ entity: "sale", operation: "create", payload: { lines: [] } });
    expect(sale.href).toBe("/ventas/nueva");
    expect(sale.note).toMatch(/no se puede rellenar/);
    const other = correctionFor({ entity: "supplier", operation: "patch", payload: {} });
    expect(other.href).toBeNull();
    expect(other.note).toMatch(/descarta/);
  });
  it("a rejected caja open reopens Caja with the original opening amount", () => {
    expect(correctionFor({ entity: "cashSession", operation: "open", payload: { openingFloat: 9000 } }).href).toBe("/mas/caja?monto=9000");
    expect(correctionFor({ entity: "cashSession", operation: "open", payload: { openingFloat: 0 } }).href).toBe("/mas/caja");
    expect(correctionFor({ entity: "cashSession", operation: "close", payload: { countedEfectivo: 5 } }).href).toBe("/mas/caja");
  });

  it("garbage ids/amounts are not put in the URL", () => {
    expect(correctionFor({ entity: "customerPayment", operation: "pay", payload: { customerId: "../x?y", amount: -1 } }).href).toBeNull();
    expect(correctionFor({ entity: "cashMove", operation: "create", payload: { kind: "aporte", amount: "1e9" } }).href).toBe("/mas/caja/aporte");
  });
});
