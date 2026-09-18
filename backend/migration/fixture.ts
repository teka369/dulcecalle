import type { DexieDump } from "./types";

/** 2026-09-17 23:30 America/Bogota */
export const TS_SEP17_2330 = Date.parse("2026-09-18T04:30:00.000Z");
/** 2026-09-18 00:00 America/Bogota */
export const TS_SEP18_0000 = Date.parse("2026-09-18T05:00:00.000Z");
const OPENED = Date.parse("2026-09-17T13:00:00.000Z");
const CLOSED = Date.parse("2026-09-18T00:30:00.000Z");
const CREATED = Date.parse("2026-09-17T12:00:00.000Z");

const PAID_SALE_RID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CREDIT_SALE_RID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAY_RID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RETURN_RID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/**
 * Isolated TEST copy. Not the phone IndexedDB.
 * InitialDebt sum is 45_000 COP by construction of this fixture.
 */
export function testDexieDump(): DexieDump {
  return {
    source: "TEST_FIXTURE",
    notProduction: true,
    tables: {
      products: [
        {
          id: 1,
          name: "Galleta de chocolate italiano",
          category: "Galletas",
          price: 1000,
          avgCost: 0,
          stock: 12,
          lowStockAt: 5,
          createdAt: CREATED,
          updatedAt: TS_SEP17_2330,
        },
        {
          id: 2,
          name: "Caramelo histórico",
          category: "Caramelos",
          price: 1000,
          avgCost: 500,
          stock: 9,
          lowStockAt: 3,
          createdAt: CREATED,
          updatedAt: TS_SEP17_2330,
        },
        {
          id: 3,
          name: "Chicle menta",
          category: "Chicles",
          price: 500,
          avgCost: 200,
          stock: 7,
          lowStockAt: 5,
          createdAt: CREATED,
          updatedAt: CREATED,
        },
      ],
      customers: [
        {
          id: 1,
          name: "Doña Rosa",
          phone: "3001234567",
          debt: 0,
          createdAt: CREATED,
          updatedAt: CREATED,
        },
        {
          id: 2,
          name: "Vecina María",
          debt: 45_000,
          createdAt: CREATED,
          updatedAt: CREATED,
        },
        {
          id: 3,
          name: "Fiado Juan",
          debt: 300,
          createdAt: CREATED,
          updatedAt: TS_SEP17_2330,
        },
      ],
      suppliers: [
        {
          id: 1,
          name: "Distribuidora Sol",
          phone: "3015556677",
          notes: "Entrega martes",
          createdAt: CREATED,
          updatedAt: CREATED,
        },
      ],
      sales: [
        {
          id: 1,
          createdAt: TS_SEP17_2330,
          customerId: null,
          paymentKind: "paid",
          saleTotal: 3000,
          amountReceived: 3000,
          credit: 0,
          requestId: PAID_SALE_RID,
        },
        {
          id: 2,
          createdAt: TS_SEP17_2330 + 60_000,
          customerId: 3,
          paymentKind: "credit",
          saleTotal: 1600,
          amountReceived: 0,
          credit: 1600,
          requestId: CREDIT_SALE_RID,
        },
      ],
      saleLines: [
        {
          id: 1,
          saleId: 1,
          productId: 1,
          productName: "Galleta de chocolate italiano",
          qty: 3,
          unitPrice: 1000,
          unitCost: 0,
          lineTotal: 3000,
        },
        {
          id: 2,
          saleId: 2,
          productId: 2,
          productName: "Caramelo histórico",
          qty: 2,
          unitPrice: 800,
          unitCost: 300,
          lineTotal: 1600,
        },
      ],
      saleReturns: [
        {
          id: 1,
          saleId: 2,
          createdAt: TS_SEP17_2330 + 120_000,
          requestId: RETURN_RID,
          refundAmount: 0,
          debtReduced: 800,
          method: null,
        },
      ],
      saleReturnLines: [
        {
          id: 1,
          returnId: 1,
          saleLineId: 2,
          productId: 2,
          qty: 1,
          unitPrice: 800,
          unitCost: 300,
        },
      ],
      stockMoves: [
        {
          id: 1,
          productId: 1,
          delta: 15,
          reason: "inicial",
          unitCost: 0,
          refType: "product",
          refId: 1,
          note: "Me lo regalaron / costo desconocido",
          createdAt: CREATED,
        },
        {
          id: 2,
          productId: 1,
          delta: -3,
          reason: "sale",
          unitCost: 0,
          refType: "sale",
          refId: 1,
          createdAt: TS_SEP17_2330,
        },
        {
          id: 3,
          productId: 2,
          delta: 10,
          reason: "inicial",
          unitCost: 300,
          refType: "product",
          refId: 2,
          createdAt: CREATED,
        },
        {
          id: 4,
          productId: 2,
          delta: -2,
          reason: "sale",
          unitCost: 300,
          refType: "sale",
          refId: 2,
          createdAt: TS_SEP17_2330 + 60_000,
        },
        {
          id: 5,
          productId: 2,
          delta: 1,
          reason: "devolucion",
          unitCost: 300,
          refType: "saleReturn",
          refId: 1,
          createdAt: TS_SEP17_2330 + 120_000,
        },
      ],
      cashSessions: [
        {
          id: 1,
          localDate: "2026-09-17",
          openedAt: OPENED,
          closedAt: CLOSED,
          openingFloat: 5000,
          closingCount: 7800,
          expectedEfectivo: 7800,
          expectedNequi: 500,
          difference: 0,
        },
      ],
      cashMoves: [
        {
          id: 1,
          amount: 3000,
          direction: "in",
          method: "Efectivo",
          kind: "sale",
          refType: "sale",
          refId: 1,
          sessionId: 1,
          createdAt: TS_SEP17_2330,
        },
        {
          id: 2,
          amount: 500,
          direction: "in",
          method: "Nequi",
          kind: "debt_collect",
          refType: "customerPayment",
          refId: 1,
          sessionId: 1,
          createdAt: TS_SEP17_2330 + 90_000,
        },
        {
          id: 3,
          amount: 200,
          direction: "out",
          method: "Efectivo",
          kind: "expense",
          refType: "expense",
          refId: 1,
          sessionId: 1,
          createdAt: TS_SEP17_2330 + 30_000,
        },
      ],
      customerPayments: [
        {
          id: 1,
          customerId: 3,
          amount: 500,
          method: "Nequi",
          createdAt: TS_SEP17_2330 + 90_000,
          requestId: PAY_RID,
        },
      ],
      initialDebts: [
        {
          id: 1,
          customerId: 2,
          amount: 45_000,
          createdAt: CREATED,
          note: "Deuda anterior TEST",
          requestId: "inicial-vecina-1",
        },
      ],
      expenses: [
        {
          id: 1,
          amount: 200,
          category: "Arriendo",
          method: "Efectivo",
          createdAt: TS_SEP17_2330 + 30_000,
          requestId: "gasto-arriendo-1",
        },
      ],
      settings: [
        { key: "demoLoaded", value: "1" },
        { key: "businessName", value: "DulceCalle TEST" },
      ],
    },
  };
}

export const TZ_EDGE_SALE_AT = {
  beforeBogotaMidnight: TS_SEP17_2330,
  atBogotaMidnight: TS_SEP18_0000,
};
