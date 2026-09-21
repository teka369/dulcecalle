/**
 * M6 local cache shapes. PKs are client UUIDs.
 * stock / debt / avgCost / expected* are CACHE / OPTIMISTIC — PostgreSQL is
 * the financial authority. Do not treat these as source of truth.
 */
import type { CustomerLedger } from "../http/customer-api";

export type CatalogResource = "products" | "customers" | "suppliers";

export type LocalCacheMeta = {
  /** `${businessId}::${resource}` — not a UUID. */
  id: string;
  businessId: string;
  resource: CatalogResource;
  cachedAt: number;
};

/**
 * M6.10 — Customer portal ledger snapshot. Keyed by customerId (the portal
 * never uses businessId; identity comes from the token). Read-only copy of
 * the last successful GET /customer/me/ledger. Never invent rows: presence
 * of the row means "cached", even when the ledger itself is empty.
 */
export type CustomerLedgerSnapshot = {
  customerId: string;
  ledger: CustomerLedger;
  capturedAt: number;
};

export type PrepTaskStatus = "pending" | "running" | "done" | "failed";

export type PrepTaskRecord = {
  key: string;
  status: PrepTaskStatus;
  error: string | null;
  finishedAt: number | null;
};

/**
 * Offline preparation readiness (admin, per business). Records that the
 * device warmed the documents + catalogs the offline flows need. Never
 * stores business data itself.
 */
export type PrepReadiness = {
  /** `readiness::<businessId>`. */
  id: string;
  businessId: string;
  status: "ready" | "failed";
  prepVersion: number;
  dbVersion: number;
  completedAt: number;
  tasks: PrepTaskRecord[];
};

export type LocalEntityId = string;

export type OutboxStatus = "pending" | "in_flight" | "synced" | "failed";

export type OutboxEntity =
  | "product"
  | "customer"
  | "supplier"
  | "sale"
  | "saleLine"
  | "saleReturn"
  | "saleReturnLine"
  | "customerPayment"
  | "initialDebt"
  | "stockMove"
  | "cashSession"
  | "cashMove"
  | "expense";

export type OutboxOperation =
  | "create"
  | "patch"
  | "archive"
  | "surtir"
  | "shrink"
  | "open"
  | "close"
  | "pay"
  | "return";

export type LocalProduct = {
  id: string;
  businessId: string;
  name: string;
  category: string;
  price: number;
  /** CACHE / OPTIMISTIC — server weighted average. */
  avgCost: number;
  /** CACHE / OPTIMISTIC — server stock. */
  stock: number;
  lowStockAt: number;
  archivedAt: string | null;
  createdAt: number;
  updatedAt: number;
};

export type LocalCustomer = {
  id: string;
  businessId: string;
  /** null until the server assigns DC-NNNN. Never invent DC-TEMP / DC-PENDING. */
  code: string | null;
  /** Request id while this locally-created row is pending/syncing. */
  requestId?: string;
  name: string;
  phone: string | null;
  /** CACHE / OPTIMISTIC — server debt. */
  debt: number;
  archivedAt: string | null;
  createdAt: number;
  updatedAt: number;
};

export type LocalSupplier = {
  id: string;
  businessId: string;
  name: string;
  /** Request id while this locally-created row is pending/syncing. */
  requestId?: string;
  phone: string | null;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

export type LocalSale = {
  id: string;
  businessId: string;
  customerId: string | null;
  paymentKind: "paid" | "partial" | "credit";
  method: "Efectivo" | "Nequi" | null;
  saleTotal: number;
  amountReceived: number;
  credit: number;
  requestId: string;
  note: string | null;
  occurredOn: string;
  createdAt: number;
  updatedAt: number;
};

export type LocalSaleLine = {
  id: string;
  businessId: string;
  saleId: string;
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  createdAt: number;
};

export type LocalSaleReturn = {
  id: string;
  businessId: string;
  saleId: string;
  refundAmount: number;
  debtReduced: number;
  method: "Efectivo" | "Nequi" | null;
  requestId: string;
  note: string | null;
  occurredOn: string;
  createdAt: number;
  updatedAt: number;
};

export type LocalSaleReturnLine = {
  id: string;
  businessId: string;
  returnId: string;
  saleLineId: string;
  productId: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  createdAt: number;
};

export type LocalStockMove = {
  id: string;
  businessId: string;
  productId: string;
  delta: number;
  reason: string;
  unitCost: number;
  supplierId: string | null;
  refType: string | null;
  refId: string | null;
  note: string | null;
  requestId: string | null;
  occurredOn: string;
  createdAt: number;
};

export type LocalCashSession = {
  id: string;
  businessId: string;
  localDate: string;
  openedAt: number;
  closedAt: number | null;
  openingFloat: number;
  closingCount: number | null;
  /** SNAPSHOT at close — not live authority. */
  expectedEfectivo: number | null;
  expectedNequi: number | null;
  difference: number | null;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  requestId?: string;
};

export type LocalCashMove = {
  id: string;
  businessId: string;
  amount: number;
  direction: "in" | "out";
  method: "Efectivo" | "Nequi";
  kind: string;
  sessionId: string | null;
  refType: string | null;
  refId: string | null;
  requestId: string | null;
  note: string | null;
  occurredOn: string;
  createdAt: number;
};

export type LocalExpense = {
  id: string;
  businessId: string;
  amount: number;
  category: string;
  note: string | null;
  method: "Efectivo" | "Nequi";
  requestId: string;
  occurredOn: string;
  createdAt: number;
};

export type LocalCustomerPayment = {
  id: string;
  businessId: string;
  customerId: string;
  amount: number;
  method: "Efectivo" | "Nequi";
  saleId: string | null;
  requestId: string;
  note: string | null;
  occurredOn: string;
  createdAt: number;
};

export type LocalInitialDebt = {
  id: string;
  businessId: string;
  customerId: string;
  amount: number;
  note: string | null;
  requestId: string;
  occurredOn: string;
  createdAt: number;
};

export type OutboxItem = {
  operationId: string;
  businessId: string;
  entity: OutboxEntity;
  operation: OutboxOperation;
  requestId: string;
  payload: unknown;
  dependsOn: string[];
  localCreatedAt: number;
  status: OutboxStatus;
  remoteId: string | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: number | null;
};
