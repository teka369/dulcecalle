import { describe, expect, it } from "vitest";
import {
  DASHBOARD_ACTIONS,
  buildDashboardSnapshot,
  formatDashboardDate,
  greetingForHour,
} from "./snapshot";
import type {
  CashSession,
  Customer,
  CustomerPayment,
  InitialDebt,
  Product,
  Sale,
  SaleReturn,
  StockMove,
} from "@/domain/types";

const empty = {
  sales: [] as Sale[],
  customers: [] as Customer[],
  products: [] as Product[],
  payments: [] as CustomerPayment[],
  returns: [] as SaleReturn[],
  initials: [] as InitialDebt[],
  stockMoves: [] as StockMove[],
  session: null as CashSession | null,
  cajaExpectedEfectivo: null as number | null,
  emptyDb: true,
};

describe("dashboard snapshot", () => {
  it("greets by hour and never invents a person name", () => {
    expect(greetingForHour(8)).toBe("Buenos días");
    expect(greetingForHour(15)).toBe("Buenas tardes");
    expect(greetingForHour(21)).toBe("Buenas noches");
    const snap = buildDashboardSnapshot({ ...empty, businessName: null });
    expect(snap.greeting).toMatch(/^Buenos |^Buenas /);
    expect(snap.businessLabel).toBeNull();
  });

  it("formats the date as Viernes, 18 de Septiembre without capitalizing de", () => {
    const label = formatDashboardDate(new Date(2026, 8, 18, 15, 0, 0).getTime());
    expect(label).toBe("Viernes, 18 de Septiembre");
    expect(label).not.toMatch(/\bDe\b/);
  });

  it("uses businessName from settings when present", () => {
    const snap = buildDashboardSnapshot({
      ...empty,
      emptyDb: false,
      businessName: "DulceCalle",
    });
    expect(snap.businessLabel).toBe("DulceCalle");
  });

  it("counts today's sales only and keeps yesterday out", () => {
    const now = new Date(2026, 8, 18, 15, 0, 0).getTime();
    const sales: Sale[] = [
      {
        id: 1,
        createdAt: now - 60_000,
        customerId: null,
        paymentKind: "paid",
        saleTotal: 4_000,
        amountReceived: 4_000,
        credit: 0,
      },
      {
        id: 2,
        createdAt: now - 26 * 60 * 60 * 1000,
        customerId: null,
        paymentKind: "paid",
        saleTotal: 9_000,
        amountReceived: 9_000,
        credit: 0,
      },
    ];
    const snap = buildDashboardSnapshot({ ...empty, emptyDb: false, sales, now });
    expect(snap.todaySalesCount).toBe(1);
    expect(snap.todaySalesTotal).toBe(4_000);
  });

  it("sums outstanding debt and lists debtors, ignoring zero-debt customers", () => {
    const customers: Customer[] = [
      { id: 1, name: "Ana", debt: 8_000, createdAt: 1, updatedAt: 1 },
      { id: 2, name: "Luis", debt: 4_500, createdAt: 1, updatedAt: 1 },
      { id: 3, name: "Al día", debt: 0, createdAt: 1, updatedAt: 1 },
    ];
    const snap = buildDashboardSnapshot({ ...empty, emptyDb: false, customers });
    expect(snap.debtTotal).toBe(12_500);
    expect(snap.debtorCount).toBe(2);
    expect(snap.debtors.map((d) => d.name)).toEqual(["Ana", "Luis"]);
  });

  it("keeps at most 5 debtors while totaling all debts", () => {
    const customers: Customer[] = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      name: `C${i + 1}`,
      debt: (7 - i) * 1000,
      createdAt: 1,
      updatedAt: 1,
    }));
    const snap = buildDashboardSnapshot({ ...empty, emptyDb: false, customers });
    expect(snap.debtorCount).toBe(7);
    expect(snap.debtors).toHaveLength(5);
    expect(snap.debtTotal).toBe(28_000);
  });

  it("flags low stock with the product's own lowStockAt", () => {
    const products: Product[] = [
      {
        id: 1,
        name: "Jet",
        category: "Dulce",
        price: 1000,
        avgCost: 400,
        stock: 3,
        lowStockAt: 5,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 2,
        name: "Ok",
        category: "Dulce",
        price: 1000,
        avgCost: 400,
        stock: 20,
        lowStockAt: 5,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const snap = buildDashboardSnapshot({ ...empty, emptyDb: false, products });
    expect(snap.productCount).toBe(2);
    expect(snap.lowStockCount).toBe(1);
    expect(snap.lowStock).toEqual([
      { id: 1, name: "Jet", stock: 3, lowStockAt: 5 },
    ]);
  });

  it("reports caja none / open / closed without inventing a balance", () => {
    expect(buildDashboardSnapshot(empty).cajaState).toBe("none");
    expect(buildDashboardSnapshot(empty).cajaExpectedEfectivo).toBeNull();

    const open: CashSession = {
      id: 1,
      localDate: "2026-09-18",
      openedAt: 1,
      closedAt: null,
      openingFloat: 10_000,
      closingCount: null,
    };
    const opened = buildDashboardSnapshot({
      ...empty,
      emptyDb: false,
      session: open,
      cajaExpectedEfectivo: 12_000,
    });
    expect(opened.cajaState).toBe("open");
    expect(opened.cajaExpectedEfectivo).toBe(12_000);

    const closed = buildDashboardSnapshot({
      ...empty,
      emptyDb: false,
      session: { ...open, closedAt: 2 },
      cajaExpectedEfectivo: 12_000,
    });
    expect(closed.cajaState).toBe("closed");
  });

  it("builds activity from real rows and skips empty", () => {
    expect(buildDashboardSnapshot(empty).activity).toEqual([]);
    const now = Date.now();
    const customers: Customer[] = [
      { id: 1, name: "Rosa", debt: 5_000, createdAt: 1, updatedAt: 1 },
    ];
    const sales: Sale[] = [
      {
        id: 10,
        createdAt: now,
        customerId: 1,
        paymentKind: "credit",
        saleTotal: 5_000,
        amountReceived: 0,
        credit: 5_000,
      },
    ];
    const payments: CustomerPayment[] = [
      {
        id: 1,
        customerId: 1,
        amount: 2_000,
        method: "Efectivo",
        createdAt: now + 1,
      },
    ];
    const initials: InitialDebt[] = [
      { id: 1, customerId: 1, amount: 3_000, createdAt: now - 10 },
    ];
    const snap = buildDashboardSnapshot({
      ...empty,
      emptyDb: false,
      customers,
      sales,
      payments,
      initials,
    });
    expect(snap.activity.map((a) => a.kind)).toEqual(["pago", "fiado", "inicial"]);
    expect(snap.activity.find((a) => a.kind === "fiado")?.detail).toBe("Rosa");
    expect(snap.activity.find((a) => a.kind === "pago")?.amount).toBe(2_000);
  });

  it("exposes the existing quick-action routes", () => {
    expect(DASHBOARD_ACTIONS.map((a) => a.href)).toEqual([
      "/ventas/nueva",
      "/clientes",
      "/inventario/nuevo",
      "/mas/caja",
    ]);
  });

  it("does not depend on a color palette", () => {
    const snap = buildDashboardSnapshot(empty);
    expect(snap).not.toHaveProperty("palette");
    expect(JSON.stringify(snap.actions)).not.toMatch(/#[0-9A-Fa-f]{3,8}/);
  });
});
