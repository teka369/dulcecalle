import { publicCustomerLedger } from "./customer-access.service";

function ledgerWithLine() {
  const line = {
    id: "44444444-4444-4333-8333-444444444444",
    productId: "33333333-3333-4333-8333-333333333333",
    productName: "Enchilada Gomita",
    qty: 2,
    unitPrice: 6000,
    unitCost: 2000,
    lineTotal: 12000,
  };
  return {
    customer: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "DC-0001",
      name: "Rosa",
      debt: 12000,
      createdAt: new Date(),
    },
    initials: [],
    sales: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        paymentKind: "credit",
        method: null,
        saleTotal: 12000,
        amountReceived: 0,
        credit: 12000,
        note: null,
        occurredOn: "2026-09-22",
        createdAt: new Date(),
        lines: [line],
        returns: [],
      },
    ],
    payments: [],
  } as never;
}

describe("publicCustomerLedger", () => {
  it("exposes productId on sale lines so the portal can match catalog photos", () => {
    const pub = publicCustomerLedger(ledgerWithLine());
    expect(pub.sales[0]?.lines[0]).toMatchObject({
      productId: "33333333-3333-4333-8333-333333333333",
      productName: "Enchilada Gomita",
    });
  });

  it("never exposes cost, supplier, or internal stock fields", () => {
    const pub = publicCustomerLedger(ledgerWithLine());
    const dumped = JSON.stringify(pub);
    expect(dumped).not.toContain("unitCost");
    expect(dumped).not.toContain("supplier");
    expect(dumped).not.toContain("lowStockAt");
    expect(dumped).not.toContain("businessId");
    expect(pub.sales[0]?.lines[0]).not.toHaveProperty("unitCost");
  });
});
