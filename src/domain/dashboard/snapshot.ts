import { addCop } from "@/domain/money";
import { startOfLocalDay } from "@/domain/cash";
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

export type DashboardCajaState = "open" | "closed" | "none";

export type DashboardActivity = {
  id: string;
  at: number;
  kind:
    | "venta"
    | "fiado"
    | "pago"
    | "devolucion"
    | "inicial"
    | "inventario"
    | "caja";
  title: string;
  detail?: string;
  amount?: number;
  href?: string;
};

export type DashboardQuickAction = {
  href: string;
  label: string;
  primary?: boolean;
};

export type DashboardSnapshot = {
  greeting: string;
  dateLabel: string;
  businessLabel: string | null;
  todaySalesTotal: number;
  todaySalesCount: number;
  debtTotal: number;
  debtorCount: number;
  debtors: Array<{ id: number; name: string; debt: number }>;
  cajaState: DashboardCajaState;
  cajaExpectedEfectivo: number | null;
  productCount: number;
  lowStockCount: number;
  lowStock: Array<{ id: number; name: string; stock: number; lowStockAt: number }>;
  activity: DashboardActivity[];
  emptyDb: boolean;
  actions: DashboardQuickAction[];
};

export const DASHBOARD_ACTIONS: DashboardQuickAction[] = [
  { href: "/ventas/nueva", label: "Nueva venta", primary: true },
  { href: "/clientes", label: "Clientes" },
  { href: "/inventario/nuevo", label: "Agregar producto" },
  { href: "/mas/caja", label: "Caja" },
];

export function greetingForHour(hour: number): string {
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

export function formatDashboardDate(ms: number): string {
  const d = new Date(ms);
  const weekday = new Intl.DateTimeFormat("es-CO", { weekday: "long" }).format(d);
  const day = new Intl.DateTimeFormat("es-CO", { day: "numeric" }).format(d);
  const month = new Intl.DateTimeFormat("es-CO", { month: "long" }).format(d);
  return `${capitalizeEs(weekday)}, ${day} de ${capitalizeEs(month)}`;
}

function capitalizeEs(value: string): string {
  const s = value.trim();
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase("es-CO") + s.slice(1);
}

const STOCK_LABEL: Partial<Record<StockMove["reason"], string>> = {
  surtir: "Surtir",
  me_lo_comi: "Me lo comí",
  regalar: "Regalo",
  perdido: "Perdido",
  adjust: "Ajuste",
};

export function buildDashboardSnapshot(input: {
  now?: number;
  businessName?: string | null;
  sales: Sale[];
  customers: Customer[];
  products: Product[];
  payments: CustomerPayment[];
  returns: SaleReturn[];
  initials: InitialDebt[];
  stockMoves: StockMove[];
  session: CashSession | null;
  cajaExpectedEfectivo: number | null;
  emptyDb: boolean;
}): DashboardSnapshot {
  const now = input.now ?? Date.now();
  const today = startOfLocalDay(now);
  const todays = input.sales.filter((s) => s.createdAt >= today);
  const todaySalesTotal = todays.reduce((s, sale) => addCop(s, sale.saleTotal), 0);

  const debtors = input.customers
    .filter((c) => c.debt > 0 && c.id != null)
    .map((c) => ({ id: c.id as number, name: c.name, debt: c.debt }))
    .sort((a, b) => b.debt - a.debt);
  const debtTotal = debtors.reduce((s, c) => addCop(s, c.debt), 0);

  const lowStock = input.products
    .filter((p) => p.id != null && p.stock <= p.lowStockAt)
    .map((p) => ({
      id: p.id as number,
      name: p.name,
      stock: p.stock,
      lowStockAt: p.lowStockAt,
    }))
    .sort((a, b) => a.stock - b.stock);

  let cajaState: DashboardCajaState = "none";
  if (input.session) {
    cajaState = input.session.closedAt != null ? "closed" : "open";
  }

  const customersById = new Map(
    input.customers
      .filter((c) => c.id != null)
      .map((c) => [c.id as number, c]),
  );
  const productsById = new Map(
    input.products
      .filter((p) => p.id != null)
      .map((p) => [p.id as number, p]),
  );
  const saleIds = new Set(
    input.sales.map((s) => s.id).filter((id): id is number => id != null),
  );

  const activity: DashboardActivity[] = [];

  for (const s of input.sales) {
    if (s.id == null) continue;
    const customer =
      s.customerId != null ? customersById.get(s.customerId) : undefined;
    if (s.credit > 0) {
      activity.push({
        id: `sale-${s.id}`,
        at: s.createdAt,
        kind: "fiado",
        title: s.paymentKind === "partial" ? "Venta parcial" : "Fiado",
        detail: customer?.name,
        amount: s.credit,
        href: `/ventas/${s.id}`,
      });
    } else {
      activity.push({
        id: `sale-${s.id}`,
        at: s.createdAt,
        kind: "venta",
        title: "Venta",
        detail: customer?.name,
        amount: s.saleTotal,
        href: `/ventas/${s.id}`,
      });
    }
  }

  for (const p of input.payments) {
    const customer = customersById.get(p.customerId);
    activity.push({
      id: `pay-${p.id ?? p.createdAt}`,
      at: p.createdAt,
      kind: "pago",
      title: "Pago",
      detail: customer?.name,
      amount: p.amount,
      href: customer?.id != null ? `/clientes/${customer.id}` : "/clientes",
    });
  }

  for (const r of input.returns) {
    if (!saleIds.has(r.saleId)) continue;
    const sale = input.sales.find((s) => s.id === r.saleId);
    const customer =
      sale?.customerId != null ? customersById.get(sale.customerId) : undefined;
    activity.push({
      id: `dev-${r.id ?? r.createdAt}`,
      at: r.createdAt,
      kind: "devolucion",
      title: "Devolución",
      detail: customer?.name,
      amount: r.debtReduced > 0 ? r.debtReduced : r.refundAmount,
      href: `/ventas/${r.saleId}`,
    });
  }

  for (const d of input.initials) {
    const customer = customersById.get(d.customerId);
    activity.push({
      id: `inicial-${d.id ?? d.createdAt}`,
      at: d.createdAt,
      kind: "inicial",
      title: "Deuda inicial",
      detail: customer?.name,
      amount: d.amount,
      href: customer?.id != null ? `/clientes/${customer.id}` : "/clientes",
    });
  }

  for (const m of input.stockMoves) {
    const label = STOCK_LABEL[m.reason];
    if (!label || m.id == null) continue;
    const product = productsById.get(m.productId);
    activity.push({
      id: `stock-${m.id}`,
      at: m.createdAt,
      kind: "inventario",
      title: label,
      detail: product
        ? `${product.name} · ${m.delta > 0 ? "+" : ""}${m.delta}`
        : undefined,
      href: `/inventario/${m.productId}`,
    });
  }

  if (input.session) {
    activity.push({
      id: `caja-open-${input.session.id ?? input.session.openedAt}`,
      at: input.session.openedAt,
      kind: "caja",
      title: "Caja abierta",
      href: "/mas/caja",
    });
    if (input.session.closedAt != null) {
      activity.push({
        id: `caja-close-${input.session.id ?? input.session.closedAt}`,
        at: input.session.closedAt,
        kind: "caja",
        title: "Caja cerrada",
        href: "/mas/caja",
      });
    }
  }

  activity.sort((a, b) => b.at - a.at);

  const name = input.businessName?.trim() || null;

  return {
    greeting: greetingForHour(new Date(now).getHours()),
    dateLabel: formatDashboardDate(now),
    businessLabel: name,
    todaySalesTotal,
    todaySalesCount: todays.length,
    debtTotal,
    debtorCount: debtors.length,
    debtors: debtors.slice(0, 5),
    cajaState,
    cajaExpectedEfectivo: input.session ? input.cajaExpectedEfectivo : null,
    productCount: input.products.length,
    lowStockCount: lowStock.length,
    lowStock: lowStock.slice(0, 5),
    activity: activity.slice(0, 8),
    emptyDb: input.emptyDb,
    actions: DASHBOARD_ACTIONS,
  };
}
