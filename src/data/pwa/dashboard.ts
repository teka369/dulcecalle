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

function isToday(ms: number, today: string): boolean {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
  }).format(new Date(ms)) === today;
}

function timestampOf(value: Record<string, unknown>): number | null {
  const raw = value.createdAt ?? value.occurredAt ?? value.date;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const ms = Date.parse(raw);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function uuidOf(value: Record<string, unknown>): string | null {
  return typeof value.id === "string" ? value.id : null;
}

type LedgerBundle = {
  customer: Record<string, unknown>;
  initials: Record<string, unknown>[];
  sales: Array<Record<string, unknown> & {
    returns?: Record<string, unknown>[];
  }>;
  payments: Record<string, unknown>[];
};

let businessNameCache: { businessId: string; name: string } | null = null;

export async function loadHttpDashboard(): Promise<DashboardSnapshot> {
  const api = getPwaApi();
  const today = todayKey();

  const [products, customers, sales, cash, me] = await Promise.all([
    api.products.list(),
    api.customers.list(),
    api.sales.list(today, today),
    api.cash.today(),
    api.auth.me().catch(() => null),
  ]);

  const [ledgers, stockMoveGroups] = await Promise.all([
    Promise.all(
      customers.map((customer) =>
        api.customers.ledger(customer.id).catch((): LedgerBundle => ({
          customer: { id: customer.id, name: customer.name },
          initials: [],
          sales: [],
          payments: [],
        })),
      ),
    ),
    Promise.all(
      products.map((product) =>
        api.inventory.moves(product.id).catch(() => []),
      ),
    ),
  ]);

  if (me?.memberships.length) {
    const businessId = api.session.businessId;
    const membership = me.memberships.find((m) => m.businessId === businessId);
    if (membership) {
      businessNameCache = {
        businessId: membership.businessId,
        name: membership.business.name,
      };
    }
  }

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
  const activityIds = new Set<string>();

  const pushActivity = (row: DashboardSnapshot["activity"][number]) => {
    if (activityIds.has(row.id)) return;
    activityIds.add(row.id);
    activity.push(row);
  };

  for (const s of sales) {
    const customer = s.customerId ? customersById.get(s.customerId) : undefined;
    pushActivity({
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

  for (const ledger of ledgers) {
    const customerId =
      typeof ledger.customer.id === "string" ? ledger.customer.id : null;
    const customer =
      customerId ? customersById.get(customerId) : undefined;

    for (const payment of ledger.payments) {
      const at = timestampOf(payment);
      const id = uuidOf(payment);
      if (at == null || !id || !isToday(at, today)) continue;
      pushActivity({
        id: `pay-${id}`,
        at,
        kind: "pago",
        title: "Pago",
        detail: customer?.name,
        amount: Number(payment.amount),
        href: customer ? `/clientes/${customer.id}` : "/clientes",
      });
    }

    for (const initial of ledger.initials) {
      const at = timestampOf(initial);
      const id = uuidOf(initial);
      if (at == null || !id || !isToday(at, today)) continue;
      pushActivity({
        id: `inicial-${id}`,
        at,
        kind: "inicial",
        title: "Deuda inicial",
        detail: customer?.name,
        amount: Number(initial.amount),
        href: customer ? `/clientes/${customer.id}` : "/clientes",
      });
    }

    for (const sale of ledger.sales) {
      const returns = Array.isArray(sale.returns) ? sale.returns : [];
      for (const returned of returns) {
        const at = timestampOf(returned);
        const id = uuidOf(returned);
        if (at == null || !id || !isToday(at, today)) continue;
        const debtReduced = Number(returned.debtReduced ?? 0);
        const refundAmount = Number(returned.refundAmount ?? 0);
        pushActivity({
          id: `dev-${id}`,
          at,
          kind: "devolucion",
          title: "Devolución",
          detail: customer?.name,
          amount: debtReduced > 0 ? debtReduced : refundAmount,
          href: `/ventas/${String(sale.id)}`,
        });
      }
    }
  }

  const returnedSaleIds = new Set(
    activity
      .filter((row) => row.kind === "devolucion")
      .map((row) => row.href?.split("/").pop())
      .filter((id): id is string => Boolean(id)),
  );

  for (const sale of sales) {
    const returns = await api.sales.returns(sale.id).catch(() => []);
    for (const returned of returns) {
      if (!isToday(returned.createdAt, today)) continue;
      pushActivity({
        id: `dev-${returned.id}`,
        at: returned.createdAt,
        kind: "devolucion",
        title: "Devolución",
        detail: sale.customerId
          ? customersById.get(sale.customerId)?.name
          : undefined,
        amount:
          returned.debtReduced > 0
            ? returned.debtReduced
            : returned.refundAmount,
        href: `/ventas/${sale.id}`,
      });
    }
  }

  for (const moves of stockMoveGroups) {
    for (const move of moves) {
      if (!isToday(move.createdAt, today)) continue;
      const label =
        move.reason === "surtir"
          ? "Surtir"
          : move.reason === "me_lo_comi"
            ? "Me lo comí"
            : move.reason === "regalar"
              ? "Regalo"
              : move.reason === "perdido"
                ? "Perdido"
                : move.reason === "adjust"
                  ? "Ajuste"
                  : null;
      if (!label) continue;
      const product = products.find((p) => p.id === move.productId);
      pushActivity({
        id: `stock-${move.id}`,
        at: move.createdAt,
        kind: "inventario",
        title: label,
        detail: product
          ? `${product.name} · ${move.delta > 0 ? "+" : ""}${move.delta}`
          : undefined,
        href: `/inventario/${move.productId}`,
      });
    }
  }

  for (const m of cash.moves) {
    if (
      m.kind === "sale" ||
      m.kind === "debt_collect" ||
      m.kind === "devolucion"
    ) {
      continue;
    }
    pushActivity({
      id: `caja-${m.id}`,
      at: m.createdAt,
      kind: "caja",
      title:
        m.kind === "aporte"
          ? "Aporte"
          : m.kind === "retiro"
            ? "Retiro"
            : m.kind === "expense"
              ? "Gasto"
              : m.kind === "compra"
                ? "Compra"
                : m.kind,
      amount: m.amount,
      href: "/mas/caja",
    });
  }

  activity.sort((a, b) => b.at - a.at);

  let cajaState: DashboardSnapshot["cajaState"] = "none";
  if (cash.session) {
    cajaState = cash.closed ? "closed" : "open";
  }

  const cachedBusinessId = api.session.businessId;
  const businessLabel =
    cachedBusinessId && businessNameCache?.businessId === cachedBusinessId
      ? businessNameCache.name
      : null;

  void returnedSaleIds;

  return {
    greeting: greetingForHour(new Date(now).getHours()),
    dateLabel: formatDashboardDate(now),
    businessLabel,
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
