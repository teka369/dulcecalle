import { describe, expect, it } from "vitest";
import type { CustomerLedger } from "../http/customer-api";
import {
  customerPortalSummary,
  customerStatementRows,
  findCustomerSale,
} from "./customer-portal";

function ledger(overrides?: Partial<CustomerLedger>): CustomerLedger {
  return {
    customer: {
      id: "c1",
      code: "DC-0001",
      name: "Rosa",
      debt: 0,
      createdAt: "2026-09-19T00:00:00.000Z",
    },
    initials: [],
    sales: [],
    payments: [],
    ...overrides,
  };
}

describe("customer portal view-model", () => {
  it("takes saldo from the server debt, even if rows would suggest otherwise", () => {
    const data = ledger({
      customer: {
        id: "c1",
        code: "DC-0001",
        name: "Rosa",
        debt: 0,
        createdAt: 1,
      },
      sales: [
        {
          id: "s1",
          paymentKind: "credit",
          method: null,
          saleTotal: 1000,
          amountReceived: 0,
          credit: 1000,
          note: null,
          occurredOn: "2026-09-19",
          createdAt: 2,
          lines: [],
          returns: [],
        },
      ],
    });
    const summary = customerPortalSummary(data);
    expect(summary.debt).toBe(0);
    expect(summary.purchases).toBe(1);
    expect(summary.credits).toBe(1);
    expect(summary.payments).toBe(0);
  });

  it("handles a customer without debt or purchases", () => {
    const summary = customerPortalSummary(ledger());
    expect(summary.debt).toBe(0);
    expect(summary.purchases).toBe(0);
    expect(summary.payments).toBe(0);
    expect(customerStatementRows(ledger())).toEqual([]);
  });

  it("orders the statement by createdAt and keeps kinds distinct", () => {
    const data = ledger({
      customer: {
        id: "c1",
        code: "DC-0001",
        name: "Rosa",
        debt: 500,
        createdAt: 1,
      },
      initials: [
        {
          id: "i1",
          amount: 45200,
          note: "viejo",
          occurredOn: "2026-09-01",
          createdAt: 10,
        },
      ],
      sales: [
        {
          id: "s1",
          paymentKind: "credit",
          method: null,
          saleTotal: 1000,
          amountReceived: 0,
          credit: 1000,
          note: null,
          occurredOn: "2026-09-19",
          createdAt: 30,
          lines: [],
          returns: [
            {
              id: "r1",
              refundAmount: 0,
              debtReduced: 500,
              method: null,
              note: null,
              occurredOn: "2026-09-19",
              createdAt: 40,
              lines: [],
            },
          ],
        },
      ],
      payments: [
        {
          id: "p1",
          amount: 2000,
          method: "Efectivo",
          occurredOn: "2026-09-18",
          createdAt: 20,
        },
      ],
    });
    const rows = customerStatementRows(data);
    expect(rows.map((r) => r.kind)).toEqual([
      "devolucion",
      "fiado",
      "pago",
      "inicial",
    ]);
    expect(findCustomerSale(data, "s1")?.credit).toBe(1000);
    expect(findCustomerSale(data, "missing")).toBeUndefined();
  });
});
