import { describe, expect, it } from "vitest";
import { buildDebtStatement, entryTitle } from "./statement";
import type {
  Customer,
  CustomerPayment,
  InitialDebt,
  Sale,
  SaleLine,
  SaleReturn,
} from "@/domain/types";

const customer: Customer = {
  id: 1,
  name: "Juan",
  debt: 12_500,
  createdAt: 1,
  updatedAt: 1,
};

describe("buildDebtStatement", () => {
  it("shows initial debt without inventing products", () => {
    const initials: InitialDebt[] = [
      { id: 1, customerId: 1, amount: 8_000, createdAt: 100, note: "De antes" },
    ];
    const statement = buildDebtStatement({
      customer: { ...customer, debt: 8_000 },
      initials,
      sales: [],
      lines: [],
      payments: [],
      returns: [],
    });
    expect(statement.entries).toHaveLength(1);
    const row = statement.entries[0];
    expect(row.kind).toBe("inicial");
    if (row.kind !== "inicial") throw new Error("expected inicial");
    expect(row.amount).toBe(8_000);
    expect(row.note).toBe("De antes");
    expect(row.runningBalance).toBe(8_000);
    expect(entryTitle(row)).toBe("Deuda inicial");
    expect("lines" in row).toBe(false);
  });

  it("lists sale lines for a credit sale and running balance", () => {
    const sales: Sale[] = [
      {
        id: 10,
        createdAt: 200,
        customerId: 1,
        paymentKind: "credit",
        saleTotal: 6_500,
        amountReceived: 0,
        credit: 6_500,
      },
    ];
    const lines: SaleLine[] = [
      {
        id: 1,
        saleId: 10,
        productId: 1,
        productName: "Chocolatina Jet",
        qty: 1,
        unitPrice: 2_500,
        unitCost: 0,
        lineTotal: 2_500,
      },
      {
        id: 2,
        saleId: 10,
        productId: 2,
        productName: "Bon Bon Bum",
        qty: 2,
        unitPrice: 2_000,
        unitCost: 0,
        lineTotal: 4_000,
      },
    ];
    const statement = buildDebtStatement({
      customer: { ...customer, debt: 6_500 },
      initials: [],
      sales,
      lines,
      payments: [],
      returns: [],
    });
    expect(statement.entries).toHaveLength(1);
    const row = statement.entries[0];
    expect(row.kind).toBe("fiada");
    if (row.kind !== "fiada") throw new Error("expected fiada");
    expect(row.lines).toHaveLength(2);
    expect(row.lines[0]?.productName).toBe("Chocolatina Jet");
    expect(row.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(6_500);
    expect(row.credit).toBe(6_500);
    expect(entryTitle(row)).toBe("Fiado #001");
  });

  it("does not turn a paid sale into a fiado", () => {
    const sales: Sale[] = [
      {
        id: 11,
        createdAt: 200,
        customerId: 1,
        paymentKind: "paid",
        saleTotal: 1_000,
        amountReceived: 1_000,
        credit: 0,
      },
    ];
    const statement = buildDebtStatement({
      customer: { ...customer, debt: 0 },
      initials: [],
      sales,
      lines: [
        {
          id: 1,
          saleId: 11,
          productId: 1,
          productName: "X",
          qty: 1,
          unitPrice: 1_000,
          unitCost: 0,
          lineTotal: 1_000,
        },
      ],
      payments: [],
      returns: [],
    });
    expect(statement.entries).toHaveLength(0);
    expect(statement.total).toBe(0);
  });

  it("shows payments and remaining balance without allocating them to a ticket", () => {
    const initials: InitialDebt[] = [
      { id: 1, customerId: 1, amount: 10_000, createdAt: 100 },
    ];
    const payments: CustomerPayment[] = [
      {
        id: 1,
        customerId: 1,
        amount: 2_000,
        method: "Efectivo",
        createdAt: 300,
      },
    ];
    const statement = buildDebtStatement({
      customer: { ...customer, debt: 8_000 },
      initials,
      sales: [],
      lines: [],
      payments,
      returns: [],
    });
    expect(statement.entries.map((e) => e.kind)).toEqual(["inicial", "abono"]);
    expect(statement.entries[1]?.runningBalance).toBe(8_000);
    expect(statement.paid).toBe(2_000);
    expect(statement.charged).toBe(10_000);
    expect(statement.total).toBe(8_000);
  });

  it("subtracts return debtReduced and keeps sale lines on the original fiado", () => {
    const sales: Sale[] = [
      {
        id: 20,
        createdAt: 100,
        customerId: 1,
        paymentKind: "credit",
        saleTotal: 5_000,
        amountReceived: 0,
        credit: 5_000,
      },
    ];
    const returns: SaleReturn[] = [
      {
        id: 1,
        saleId: 20,
        createdAt: 400,
        refundAmount: 0,
        debtReduced: 2_000,
        method: "Efectivo",
      },
    ];
    const statement = buildDebtStatement({
      customer: { ...customer, debt: 3_000 },
      initials: [],
      sales,
      lines: [
        {
          id: 1,
          saleId: 20,
          productId: 1,
          productName: "Galleta",
          qty: 2,
          unitPrice: 2_500,
          unitCost: 0,
          lineTotal: 5_000,
        },
      ],
      payments: [],
      returns,
    });
    expect(statement.entries.map((e) => e.kind)).toEqual(["fiada", "devolucion"]);
    expect(statement.entries[1]?.runningBalance).toBe(3_000);
    expect(statement.total).toBe(3_000);
  });
});
