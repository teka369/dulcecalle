import {
  DASHBOARD_ACTIONS,
  formatDashboardDate,
  greetingForHour,
  type DashboardSnapshot,
} from "@/domain/dashboard/snapshot";
import { addCop } from "@/domain/money";
import { getPwaApi } from "./api";

function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
  }).format(new Date());
}

export async function loadHttpDashboard(): Promise<DashboardSnapshot> {
  const api = getPwaApi();
  const today = todayKey();
  const [products, customers, sales, cash] = await Promise.all([
    api.products.list(),
    api.customers.list(),
    api.sales.list(today, today),
    api.cash.today(),
  ]);

  const now = Date.now();
  const debtors = customers
    .filter((c) => c.debt > 0)
    .map((c) => ({ id: c.id, name: c.name, debt: c.debt }))
    .sort((a, b) => b.debt - a.debt);
  const debtTotal = debtors.reduce((s, c) => addCop(s, c.debt), 0);
  const lowStock = products
    .filter((p) => p.stock <= p.lowStockAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      stock: p.stock,
      lowStockAt: p.lowStockAt,
    }))
    .sort((a, b) => a.stock - b.stock);

  const customersById = new Map(customers.map((c) => [c.id, c]));
  const activity: DashboardSnapshot["activity"] = [];
  for (const s of sales) {
    const customer = s.customerId ? customersById.get(s.customerId) : undefined;
    activity.push({
      id: `sale-${s.id}`,
      at: s.createdAt,
      kind: s.credit > 0 ? "fiado" : "venta",
      title:
        s.credit > 0
          ? s.paymentKind === "partial"
            ? "Venta parcial"
            : "Fiado"
          : "Venta",
      detail: customer?.name,
      amount: s.credit > 0 ? s.credit : s.saleTotal,
      href: `/ventas/${s.id}`,
    });
  }
  for (const m of cash.moves) {
    if (m.kind === "sale" || m.kind === "debt_collect") continue;
    activity.push({
      id: `caja-${m.id}`,
      at: m.createdAt,
      kind: "caja",
      title: m.kind === "aporte" ? "Aporte" : m.kind === "retiro" ? "Retiro" : m.kind,
      amount: m.amount,
      href: "/mas/caja",
    });
  }
  activity.sort((a, b) => b.at - a.at);

  let cajaState: DashboardSnapshot["cajaState"] = "none";
  if (cash.session) {
    cajaState = cash.closed ? "closed" : "open";
  }

  return {
    greeting: greetingForHour(new Date(now).getHours()),
    dateLabel: formatDashboardDate(now),
    businessLabel: null,
    todaySalesTotal: sales.reduce((s, sale) => addCop(s, sale.saleTotal), 0),
    todaySalesCount: sales.length,
    debtTotal,
    debtorCount: debtors.length,
    debtors: debtors.slice(0, 5),
    cajaState,
    cajaExpectedEfectivo: cash.session ? cash.expected.efectivo : null,
    productCount: products.length,
    lowStockCount: lowStock.length,
    lowStock: lowStock.slice(0, 5),
    activity: activity.slice(0, 8),
    emptyDb:
      products.length === 0 && customers.length === 0 && sales.length === 0,
    actions: DASHBOARD_ACTIONS,
  };
}
