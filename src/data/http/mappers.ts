/** Transport mappers only. No stock/debt/total/caja math. */

export function asCopJson(n: unknown, field: string): number {
  if (typeof n !== "number" || !Number.isInteger(n) || !Number.isSafeInteger(n)) {
    throw new Error(`${field} must be a JSON integer COP, got ${String(n)}`);
  }
  return n;
}

export function asIsoEpoch(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  throw new Error(`invalid timestamp: ${String(value)}`);
}

export function asDateKey(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`invalid occurredOn/localDate: ${String(value)}`);
  }
  return value;
}

export function asUuid(value: unknown, field: string): string {
  if (typeof value === "number") {
    throw new Error(`${field} must be a UUID string, not a Dexie number`);
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a UUID string`);
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new Error(`${field} must be a UUID string`);
  }
  return value;
}

export type RemoteProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  avgCost: number;
  stock: number;
  lowStockAt: number;
  archivedAt: string | null;
  createdAt: number;
};

export function mapProduct(raw: Record<string, unknown>): RemoteProduct {
  return {
    id: asUuid(raw.id, "product.id"),
    name: String(raw.name ?? ""),
    category: String(raw.category ?? "General"),
    price: asCopJson(raw.price, "price"),
    avgCost: asCopJson(raw.avgCost, "avgCost"),
    stock: Number(raw.stock),
    lowStockAt: Number(raw.lowStockAt),
    archivedAt: raw.archivedAt == null ? null : String(raw.archivedAt),
    createdAt: asIsoEpoch(raw.createdAt),
  };
}

export type RemoteCustomer = {
  id: string;
  name: string;
  phone: string | null;
  debt: number;
  archivedAt: string | null;
  createdAt: number;
};

export function mapCustomer(raw: Record<string, unknown>): RemoteCustomer {
  return {
    id: asUuid(raw.id, "customer.id"),
    name: String(raw.name ?? ""),
    phone: raw.phone == null ? null : String(raw.phone),
    debt: asCopJson(raw.debt, "debt"),
    archivedAt: raw.archivedAt == null ? null : String(raw.archivedAt),
    createdAt: asIsoEpoch(raw.createdAt),
  };
}

export type RemoteSaleLine = {
  id: string;
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
};

export type RemoteSale = {
  id: string;
  customerId: string | null;
  paymentKind: string;
  method: string | null;
  saleTotal: number;
  amountReceived: number;
  credit: number;
  note: string | null;
  occurredOn: string;
  createdAt: number;
  lines: RemoteSaleLine[];
};

export function mapSale(raw: Record<string, unknown>): RemoteSale {
  const linesRaw = Array.isArray(raw.lines) ? raw.lines : [];
  return {
    id: asUuid(raw.id, "sale.id"),
    customerId: raw.customerId == null ? null : asUuid(raw.customerId, "sale.customerId"),
    paymentKind: String(raw.paymentKind),
    method: raw.method == null ? null : String(raw.method),
    saleTotal: asCopJson(raw.saleTotal, "saleTotal"),
    amountReceived: asCopJson(raw.amountReceived, "amountReceived"),
    credit: asCopJson(raw.credit, "credit"),
    note: raw.note == null ? null : String(raw.note),
    occurredOn: asDateKey(raw.occurredOn),
    createdAt: asIsoEpoch(raw.createdAt),
    lines: linesRaw.map((line) => {
      const l = line as Record<string, unknown>;
      return {
        id: asUuid(l.id, "line.id"),
        productId: asUuid(l.productId, "line.productId"),
        productName: String(l.productName ?? ""),
        qty: Number(l.qty),
        unitPrice: asCopJson(l.unitPrice, "unitPrice"),
        unitCost: asCopJson(l.unitCost, "unitCost"),
        lineTotal: asCopJson(l.lineTotal, "lineTotal"),
      };
    }),
  };
}

export type RemotePayment = {
  id: string;
  customerId: string;
  amount: number;
  method: string;
  occurredOn: string;
  createdAt: number;
};

export function mapPayment(raw: Record<string, unknown>): RemotePayment {
  return {
    id: asUuid(raw.id, "payment.id"),
    customerId: asUuid(raw.customerId, "payment.customerId"),
    amount: asCopJson(raw.amount, "amount"),
    method: String(raw.method),
    occurredOn: asDateKey(raw.occurredOn),
    createdAt: asIsoEpoch(raw.createdAt),
  };
}

export type RemoteSession = {
  id: string;
  localDate: string;
  openedAt: number;
  closedAt: number | null;
  openingFloat: number;
  closingCount: number | null;
  expectedEfectivo: number | null;
  expectedNequi: number | null;
  difference: number | null;
};

export function mapSession(raw: Record<string, unknown>): RemoteSession {
  return {
    id: asUuid(raw.id, "session.id"),
    localDate: asDateKey(raw.localDate),
    openedAt: asIsoEpoch(raw.openedAt),
    closedAt: raw.closedAt == null ? null : asIsoEpoch(raw.closedAt),
    openingFloat: asCopJson(raw.openingFloat, "openingFloat"),
    closingCount:
      raw.closingCount == null ? null : asCopJson(raw.closingCount, "closingCount"),
    expectedEfectivo:
      raw.expectedEfectivo == null
        ? null
        : asCopJson(raw.expectedEfectivo, "expectedEfectivo"),
    expectedNequi:
      raw.expectedNequi == null ? null : asCopJson(raw.expectedNequi, "expectedNequi"),
    difference:
      raw.difference == null ? null : asCopJson(raw.difference, "difference"),
  };
}

export type RemoteToday = {
  localDate: string;
  session: RemoteSession | null;
  expected: { efectivo: number; nequi: number; total: number };
  closed: boolean;
};

export function mapToday(raw: Record<string, unknown>): RemoteToday {
  const expected = (raw.expected ?? {}) as Record<string, unknown>;
  return {
    localDate: asDateKey(raw.localDate),
    session:
      raw.session == null
        ? null
        : mapSession(raw.session as Record<string, unknown>),
    expected: {
      efectivo: asCopJson(expected.efectivo, "expected.efectivo"),
      nequi: asCopJson(expected.nequi, "expected.nequi"),
      total: asCopJson(expected.total, "expected.total"),
    },
    closed: Boolean(raw.closed),
  };
}
