import { CatalogService } from "../catalog/catalog.service";
import { CustomerAccessService, portalLedgerScope, publicCustomerLedger } from "./customer-access.service";

const BIZ = "11111111-1111-4111-8111-111111111111";
const CUS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakePrisma(calls: { model: string; where: unknown }[]) {
  const model = (name: string, value: unknown) => ({
    findFirst: jest.fn(async (args: { where: unknown }) => {
      calls.push({ model: name, where: args.where });
      return value;
    }),
    findMany: jest.fn(async (args: { where: unknown }) => {
      calls.push({ model: name, where: args.where });
      return [];
    }),
  });
  return {
    customer: model("customer", {
      id: CUS, businessId: BIZ, code: "DC-0001", name: "Rosa", phone: null,
      debt: 0n, createdAt: new Date(), archivedAt: null, pinHash: "x",
    }),
    initialDebt: model("initialDebt", null),
    sale: model("sale", null),
    customerPayment: model("customerPayment", null),
  };
}

describe("portal ledger scope (AC4)", () => {
  it("builds an explicit portal scope, never a staff/owner role, with the fixed Bogota zone (J-B1)", () => {
    const scope = portalLedgerScope({ customerId: CUS, businessId: BIZ });
    expect(scope).toEqual({
      kind: "portal",
      customerId: CUS,
      businessId: BIZ,
      timezone: "America/Bogota",
    });
    expect(scope).not.toHaveProperty("role");
    expect(scope).not.toHaveProperty("userId");
  });

  it("ledger() uses the portal entry point and every query is scoped by token business + customer", async () => {
    const calls: { model: string; where: unknown }[] = [];
    const prisma = fakePrisma(calls);
    const catalog = new CatalogService(prisma as never);
    const portalSpy = jest.spyOn(catalog, "portalCustomerLedger");
    const adminSpy = jest.spyOn(catalog, "customerLedger");
    const svc = new CustomerAccessService(
      prisma as never, {} as never, catalog, {} as never, {} as never,
    );
    const pub = await svc.ledger({ customerId: CUS, businessId: BIZ });

    expect(adminSpy).not.toHaveBeenCalled();
    expect(portalSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "portal", businessId: BIZ, customerId: CUS }),
    );
    const arg = portalSpy.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(arg.role).toBeUndefined();
    expect(calls.map((c) => c.model).sort()).toEqual(
      ["customer", "customerPayment", "initialDebt", "sale"],
    );
    for (const c of calls) {
      expect(c.where).toMatchObject({ businessId: BIZ });
    }
    expect(calls.find((c) => c.model === "customer")!.where).toMatchObject({ id: CUS });
    for (const c of calls.filter((c) => c.model !== "customer")) {
      expect(c.where).toMatchObject({ customerId: CUS });
    }
    expect(pub.customer.id).toBe(CUS);
  });
});

describe("publicCustomerLedger shape (AC5)", () => {
  it("strips cost, saleLineId, ids and payment note from a full admin ledger", () => {
    const now = new Date("2026-10-13T15:00:00Z");
    const raw = {
      customer: { id: CUS, code: "DC-0001", name: "Rosa", phone: "300", debt: 1, createdAt: now, businessId: BIZ, avgCost: 5 },
      initials: [{ id: "i1", customerId: CUS, amount: 1, note: "n", occurredOn: "2026-10-13", createdAt: now }],
      sales: [{
        id: "s1", customerId: CUS, paymentKind: "credit", method: null, saleTotal: 2, amountReceived: 0,
        credit: 2, note: null, occurredOn: "2026-10-13", createdAt: now,
        lines: [{ id: "l1", productId: "p1", productName: "X", qty: 1, unitPrice: 2, unitCost: 1, lineTotal: 2 }],
        returns: [{
          id: "r1", saleId: "s1", refundAmount: 0, debtReduced: 1, method: null, note: null,
          occurredOn: "2026-10-13", createdAt: now,
          lines: [{ id: "rl1", saleLineId: "l1", productId: "p1", qty: 1, unitPrice: 2, unitCost: 1 }],
        }],
      }],
      payments: [{ id: "pay1", customerId: CUS, amount: 1, method: "Nequi", note: "secreto", occurredOn: "2026-10-13", createdAt: now }],
    };
    const pub = publicCustomerLedger(raw as never);
    const blob = JSON.stringify(pub);
    for (const banned of ["unitCost", "avgCost", "saleLineId", "businessId", "customerId", "secreto", "phone", "saleId"]) {
      expect(blob).not.toContain(banned);
    }
    expect(pub.payments[0]).toEqual({
      id: "pay1", amount: 1, method: "Nequi", occurredOn: "2026-10-13", createdAt: now,
    });
    expect(Object.keys(pub.sales[0]!.lines[0]!).sort()).toEqual(
      ["id", "lineTotal", "productId", "productName", "qty", "unitPrice"],
    );
    expect(Object.keys(pub.sales[0]!.returns[0]!.lines[0]!).sort()).toEqual(["id", "qty", "unitPrice"]);
  });
});
