import { beforeEach, describe, expect, it } from "vitest";
import { getDb, __resetDbForTests } from "@/storage/db";
import { loadDashboard } from "./dashboardRepository";
import {
  cashRepository,
  customerRepository,
  productRepository,
  saleRepository,
} from "@/repositories";
import { loadDemoData, startOfLocalDay } from "@/storage/seed";
import { addCop } from "@/domain/money";
import { CASH_COPY } from "@/domain/cash";
import { DASHBOARD_ACTIONS } from "@/domain/dashboard/snapshot";

describe("loadDashboard vs Dexie", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("matches independent Dexie reads after demo seed", async () => {
    await loadDemoData();
    const db = getDb();
    const snap = await loadDashboard();
    const today = startOfLocalDay();

    const sales = await db.sales.toArray();
    const todays = sales.filter((s) => s.createdAt >= today);
    const independentTotal = todays.reduce((s, sale) => addCop(s, sale.saleTotal), 0);
    expect(snap.todaySalesCount).toBe(todays.length);
    expect(snap.todaySalesTotal).toBe(independentTotal);
    expect(independentTotal).toBe(7_000);
    expect(todays).toHaveLength(2);

    const customers = await db.customers.toArray();
    const debtors = customers
      .filter((c) => c.debt > 0)
      .sort((a, b) => b.debt - a.debt);
    expect(customers.some((c) => c.debt === 0)).toBe(true);
    expect(snap.debtorCount).toBe(debtors.length);
    expect(snap.debtTotal).toBe(debtors.reduce((s, c) => addCop(s, c.debt), 0));
    expect(snap.debtors.map((d) => d.debt)).toEqual(debtors.slice(0, 5).map((c) => c.debt));
    expect(snap.debtors.every((d) => d.debt > 0)).toBe(true);

    const products = await db.products.toArray();
    const low = products.filter((p) => p.stock <= p.lowStockAt);
    expect(snap.productCount).toBe(products.length);
    expect(snap.lowStockCount).toBe(low.length);
    expect(snap.lowStock.map((p) => p.id).sort()).toEqual(
      low
        .slice()
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 5)
        .map((p) => p.id),
    );

    const day = await cashRepository.daySummary();
    expect(snap.cajaState).toBe("open");
    expect(snap.cajaExpectedEfectivo).toBe(day.expected.efectivo);
    expect(snap.cajaExpectedEfectivo).toBe(2_000);

    expect(snap.activity.length).toBeLessThanOrEqual(8);
    const ids = snap.activity.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(snap.activity.every((a) => Number.isFinite(a.at) && a.at > 0)).toBe(true);
  });

  it("excludes sales before local midnight from Ventas hoy", async () => {
    const productId = await productRepository.create({
      name: "Jet",
      category: "Dulce",
      price: 1000,
      avgCost: 400,
      stock: 20,
      lowStockAt: 2,
    });
    const todayId = await saleRepository.createSale({
      paymentKind: "paid",
      amountReceived: 1000,
      method: "Efectivo",
      lines: [{ productId, qty: 1 }],
      requestId: "today-sale",
    });
    const yesterdayId = await saleRepository.createSale({
      paymentKind: "paid",
      amountReceived: 2000,
      method: "Efectivo",
      lines: [{ productId, qty: 2 }],
      requestId: "yesterday-sale",
    });
    await getDb().sales.update(yesterdayId, {
      createdAt: startOfLocalDay() - 1,
    });

    const snap = await loadDashboard();
    expect(snap.todaySalesCount).toBe(1);
    expect(snap.todaySalesTotal).toBe(1000);
    const todaySale = await getDb().sales.get(todayId);
    expect(todaySale?.saleTotal).toBe(1000);
  });

  it("caja none / open / closed without inventing a balance", async () => {
    const none = await loadDashboard();
    expect(none.cajaState).toBe("none");
    expect(none.cajaExpectedEfectivo).toBeNull();
    expect(CASH_COPY.estadoSinAbrir).toBe("Sin abrir");
    expect(CASH_COPY.estadoCerrada).toBe("Caja cerrada");

    await cashRepository.openSession(5_000);
    const open = await loadDashboard();
    const day = await cashRepository.daySummary();
    expect(open.cajaState).toBe("open");
    expect(open.cajaExpectedEfectivo).toBe(day.expected.efectivo);
    expect(open.cajaExpectedEfectivo).toBe(5_000);

    const session = await cashRepository.getTodaySession();
    await cashRepository.closeSession(session!.id!, 5_000);
    const closed = await loadDashboard();
    expect(closed.cajaState).toBe("closed");
    expect(CASH_COPY.estadoCerrada).toBe("Caja cerrada");
  });

  it("lists at most 5 debtors descending and ignores debt 0", async () => {
    for (let i = 0; i < 7; i++) {
      const id = await customerRepository.create({ name: `C${i}` });
      await customerRepository.recordInitialDebt({
        customerId: id,
        amount: (i + 1) * 1000,
        requestId: `debt-${i}`,
      });
    }
    const zeroId = await customerRepository.create({ name: "Al dia" });
    expect((await customerRepository.getById(zeroId))?.debt).toBe(0);

    const snap = await loadDashboard();
    expect(snap.debtorCount).toBe(7);
    expect(snap.debtors).toHaveLength(5);
    expect(snap.debtors.map((d) => d.debt)).toEqual([7000, 6000, 5000, 4000, 3000]);
    expect(snap.debtTotal).toBe(28_000);
    expect(snap.debtors.some((d) => d.name === "Al dia")).toBe(false);
  });

  it("caps activity at 8 unique real events", async () => {
    const productId = await productRepository.create({
      name: "Jet",
      category: "Dulce",
      price: 500,
      avgCost: 200,
      stock: 50,
      lowStockAt: 1,
    });
    const customerId = await customerRepository.create({ name: "Rosa" });
    for (let i = 0; i < 6; i++) {
      await saleRepository.createSale({
        paymentKind: "paid",
        amountReceived: 500,
        method: "Efectivo",
        lines: [{ productId, qty: 1 }],
        requestId: `act-sale-${i}`,
      });
    }
    await saleRepository.createSale({
      customerId,
      paymentKind: "credit",
      amountReceived: 0,
      lines: [{ productId, qty: 1 }],
      requestId: "act-fiado",
    });
    await customerRepository.recordPayment({
      customerId,
      amount: 200,
      method: "Efectivo",
      requestId: "act-abono",
    });
    await cashRepository.openSession(0);

    const snap = await loadDashboard();
    expect(snap.activity.length).toBeLessThanOrEqual(8);
    expect(new Set(snap.activity.map((a) => a.id)).size).toBe(snap.activity.length);
    const kinds = new Set(snap.activity.map((a) => a.kind));
    expect(kinds.has("venta") || kinds.has("fiado")).toBe(true);
  });

  it("exposes only existing quick-action routes", () => {
    expect(DASHBOARD_ACTIONS.map((a) => a.href)).toEqual([
      "/ventas/nueva",
      "/clientes",
      "/inventario/nuevo",
      "/mas/caja",
    ]);
  });
});
