/** Dexie dump shape for the TEST importer. Not live IndexedDB. */

export type DexieDump = {
  source: "TEST_FIXTURE" | "DEXIE";
  notProduction?: true;
  claim?: "DEVICE_COPY";
  tables: {
    products: DexieProduct[];
    customers: DexieCustomer[];
    suppliers: DexieSupplier[];
    sales: DexieSale[];
    saleLines: DexieSaleLine[];
    saleReturns: DexieSaleReturn[];
    saleReturnLines: DexieSaleReturnLine[];
    stockMoves: DexieStockMove[];
    cashSessions: DexieCashSession[];
    cashMoves: DexieCashMove[];
    customerPayments: DexiePayment[];
    initialDebts: DexieInitialDebt[];
    expenses: DexieExpense[];
    settings: DexieSetting[];
  };
};

export type DexieProduct = {
  id: number;
  name: string;
  category: string;
  price: number;
  avgCost: number;
  stock: number;
  lowStockAt: number;
  createdAt: number;
  updatedAt: number;
};

export type DexieCustomer = {
  id: number;
  name: string;
  phone?: string;
  debt: number;
  createdAt: number;
  updatedAt: number;
};

export type DexieSupplier = {
  id: number;
  name: string;
  phone?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
};

export type DexieSale = {
  id: number;
  createdAt: number;
  customerId: number | null;
  paymentKind: "paid" | "partial" | "credit";
  saleTotal: number;
  amountReceived: number;
  credit: number;
  requestId?: string;
  note?: string;
};

export type DexieSaleLine = {
  id: number;
  saleId: number;
  productId: number;
  productName: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
};

export type DexieSaleReturn = {
  id: number;
  saleId: number;
  createdAt: number;
  requestId?: string;
  refundAmount: number;
  debtReduced: number;
  method: "Efectivo" | "Nequi" | null;
  note?: string;
};

export type DexieSaleReturnLine = {
  id: number;
  returnId: number;
  saleLineId: number;
  productId: number;
  qty: number;
  unitPrice: number;
  unitCost: number;
};

export type DexieStockMove = {
  id: number;
  productId: number;
  delta: number;
  reason:
    | "sale"
    | "surtir"
    | "me_lo_comi"
    | "regalar"
    | "perdido"
    | "adjust"
    | "inicial"
    | "devolucion";
  unitCost: number;
  supplierId?: number | null;
  refType?: string;
  refId?: number;
  note?: string;
  createdAt: number;
  requestId?: string;
};

export type DexieCashSession = {
  id: number;
  localDate: string;
  openedAt: number;
  closedAt: number | null;
  openingFloat: number;
  closingCount: number | null;
  expectedEfectivo?: number | null;
  expectedNequi?: number | null;
  difference?: number | null;
  note?: string;
};

export type DexieCashMove = {
  id: number;
  amount: number;
  direction: "in" | "out";
  method: "Efectivo" | "Nequi";
  kind: string;
  refType?: string;
  refId?: number;
  sessionId?: number | null;
  note?: string;
  createdAt: number;
  requestId?: string;
};

export type DexiePayment = {
  id: number;
  customerId: number;
  amount: number;
  method: "Efectivo" | "Nequi";
  saleId?: number | null;
  createdAt: number;
  note?: string;
  requestId?: string;
};

export type DexieInitialDebt = {
  id: number;
  customerId: number;
  amount: number;
  createdAt: number;
  note?: string;
  requestId?: string;
};

export type DexieExpense = {
  id: number;
  amount: number;
  category: string;
  note?: string;
  method: "Efectivo" | "Nequi";
  createdAt: number;
  requestId?: string;
};

export type DexieSetting = { key: string; value: string };

export type ImportWarning = {
  code: string;
  message: string;
};

export type ImportResult = {
  businessId: string;
  warnings: ImportWarning[];
  mapSize: number;
};
