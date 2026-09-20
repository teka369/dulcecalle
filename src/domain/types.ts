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
  | "adjust"
  | "inicial"
  | "devolucion";

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

/**
 * Light supplier (S3) — name/phone/notes + surtir history.
 * NO accounts payable / CxP.
 */
export interface Supplier {
  id?: number;
  name: string;
  phone?: string;
  notes?: string;
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
  /** Client-generated key; same key → no second sale (stock/cash/debt). */
  requestId?: string;
  note?: string;
}

export interface SaleLine {
  id?: number;
  saleId: number;
  productId: number;
  productName: string;
  qty: number;
  /** Price SNAPSHOT at sale time (the price actually charged). */
  unitPrice: number;
  /** Cost SNAPSHOT at sale time (product.avgCost when sold). */
  unitCost: number;
  lineTotal: number;
}

export interface StockMove {
  id?: number;
  productId: number;
  delta: number;
  reason: StockMoveReason;
  unitCost: number;
  /** Optional light supplier on surtir (NO CxP). */
  supplierId?: number | null;
  refType?: string;
  refId?: number;
  note?: string;
  createdAt: number;
  /** Same key → no second surtir/shrink. */
  requestId?: string;
}

export interface CustomerPayment {
  id?: number;
  customerId: number;
  amount: number;
  method: PayMethod;
  saleId?: number | null;
  createdAt: number;
  note?: string;
  /** Client-generated key; same key → no-op (no double abono). */
  requestId?: string;
}

/**
 * Opening / pre-system debt. NOT a sale.
 * Increases customer.debt. No saleLines, stock, cash, ventas, or recibido.
 */
export interface InitialDebt {
  id?: number;
  customerId: number;
  amount: number;
  createdAt: number;
  note?: string;
  /** Client-generated key; same key → no second debt increment. */
  requestId?: string;
}

export interface Expense {
  id?: number;
  amount: number;
  category: string;
  note?: string;
  method: PayMethod;
  createdAt: number;
  /** Same key → no second gasto. */
  requestId?: string;
}

/**
 * Cash move kinds — NEVER conflate:
 * - expense (gasto operativo) ≠ retiro (owner_out) ≠ aporte (owner_in)
 * - sale / debt_collect / compra are separate from the three S4 flows
 * - Diferencia is close variance, not a move kind
 */
export type CashMoveKind =
  | "expense"
  | "retiro"
  | "aporte"
  | "sale"
  | "debt_collect"
  | "compra"
  | "devolucion"
  | string;

export interface CashMove {
  id?: number;
  amount: number;
  direction: "in" | "out";
  method: PayMethod;
  /** expense | retiro | aporte | sale | debt_collect | compra | … */
  kind: CashMoveKind;
  refType?: string;
  refId?: number;
  sessionId?: number | null;
  note?: string;
  createdAt: number;
  /** Same key → no second cash move (aporte/retiro/gasto). */
  requestId?: string;
}

/**
 * One cash session per local calendar day.
 * Close count = physical Efectivo only (Nequi tracked separately, not in billetes).
 *
 * openingFloat lives on the session, NOT as a cashMove.
 * See cashRepository.balance vs expectedBuckets.
 */
export interface CashSession {
  id?: number;
  /** Local calendar day YYYY-MM-DD (1 session / day). */
  localDate: string;
  openedAt: number;
  closedAt: number | null;
  /** Opening float in Efectivo. */
  openingFloat: number;
  /** Physical Efectivo counted at close (Nequi excluded). */
  closingCount: number | null;
  /** Snapshot: expected Efectivo at close. */
  expectedEfectivo?: number | null;
  /** Snapshot: expected Nequi at close (tracked, not counted in billetes). */
  expectedNequi?: number | null;
  /** closingCount − expectedEfectivo */
  difference?: number | null;
  note?: string;
}

export interface Setting {
  key: string;
  value: string;
}

export interface CartItem {
  productId: string;
  qty: number;
  /** Price charged on this sale; omit → catalog product.price at confirm. */
  unitPrice?: number;
}

export interface CreateSaleInput {
  lines: Array<{
    productId: number;
    qty: number;
    /** Optional override; omit → product.price at sale time. */
    unitPrice?: number;
  }>;
  paymentKind: PaymentKind;
  /** Required when paymentKind is partial or credit. */
  customerId?: number | null;
  /** Abono when partial; equals saleTotal when paid; 0 when credit. */
  amountReceived: number;
  /** Optional channel for received cash (default Efectivo). */
  method?: PayMethod;
  /** Client-generated key; same key → return existing sale, no double effects. */
  requestId?: string;
}

/**
 * A return of one sale. The original sale is NEVER edited.
 * refundAmount = cash/Nequi out. debtReduced = fiado that comes off the customer.
 */
export interface SaleReturn {
  id?: number;
  saleId: number;
  createdAt: number;
  requestId?: string;
  refundAmount: number;
  debtReduced: number;
  /** Channel for the cash refund; null when the whole return is debt-only. */
  method: PayMethod | null;
  note?: string;
}

export interface SaleReturnLine {
  id?: number;
  returnId: number;
  saleLineId: number;
  productId: number;
  qty: number;
  /** SNAPSHOT from the original sale line. */
  unitPrice: number;
  /** SNAPSHOT from the original sale line. */
  unitCost: number;
}

export interface CreateReturnInput {
  saleId: number;
  lines: Array<{ saleLineId: number; qty: number }>;
  requestId?: string;
  note?: string;
}
