/** Payment settlement mode (UI: Pagada | Parcial | Fiada). Not Efectivo/Nequi. */
export type PaymentKind = "paid" | "partial" | "credit";

/** Cash channel — used in payment breakdown / cash moves, NOT on Cobrar mode screen. */
export type PayMethod = "Efectivo" | "Nequi";

export type StockMoveReason =
  | "sale"
  | "surtir"
  | "me_lo_comi"
  | "regalar"
  | "perdido"
  | "adjust";

export interface Product {
  id?: number;
  name: string;
  category: string;
  /** Selling price snapshot base (COP integer). */
  price: number;
  /** Weighted average cost (COP integer). */
  avgCost: number;
  stock: number;
  lowStockAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Customer {
  id?: number;
  name: string;
  phone?: string;
  /** Outstanding fiado balance; always ≥ 0. */
  debt: number;
  createdAt: number;
  updatedAt: number;
}

export interface Sale {
  id?: number;
  createdAt: number;
  customerId: number | null;
  paymentKind: PaymentKind;
  /** Sum of line totals (VENTAS). */
  saleTotal: number;
  /** Cash/Nequi received now (DINERO RECIBIDO). */
  amountReceived: number;
  /** saleTotal − amountReceived (FIADO from this sale). */
  credit: number;
  note?: string;
}

export interface SaleLine {
  id?: number;
  saleId: number;
  productId: number;
  productName: string;
  qty: number;
  /** Price SNAPSHOT at sale time. */
  unitPrice: number;
  /** Cost SNAPSHOT at sale time. */
  unitCost: number;
  lineTotal: number;
}

export interface StockMove {
  id?: number;
  productId: number;
  delta: number;
  reason: StockMoveReason;
  unitCost: number;
  refType?: string;
  refId?: number;
  note?: string;
  createdAt: number;
}

export interface CustomerPayment {
  id?: number;
  customerId: number;
  amount: number;
  method: PayMethod;
  saleId?: number | null;
  createdAt: number;
  note?: string;
}

export interface Expense {
  id?: number;
  amount: number;
  category: string;
  note?: string;
  method: PayMethod;
  createdAt: number;
}

export interface CashMove {
  id?: number;
  amount: number;
  direction: "in" | "out";
  method: PayMethod;
  kind: string;
  refType?: string;
  refId?: number;
  sessionId?: number | null;
  note?: string;
  createdAt: number;
}

export interface CashSession {
  id?: number;
  openedAt: number;
  closedAt: number | null;
  openingFloat: number;
  closingCount: number | null;
  note?: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface CartItem {
  productId: number;
  qty: number;
}

export interface CreateSaleInput {
  lines: Array<{ productId: number; qty: number }>;
  paymentKind: PaymentKind;
  /** Required when paymentKind is partial or credit. */
  customerId?: number | null;
  /** Abono when partial; equals saleTotal when paid; 0 when credit. */
  amountReceived: number;
  /** Optional channel for received cash (default Efectivo). */
  method?: PayMethod;
}
