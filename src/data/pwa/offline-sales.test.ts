import { describe, expect, it } from "vitest";
import { paymentValues } from "./offline-sales";

describe("M6.5 offline sales validation", () => {
  it("accepts a fully paid cash sale", () => {
    expect(paymentValues({
      lines: [{ productId: "p", qty: 1 }],
      paymentKind: "paid",
      amountReceived: 500,
      method: "Efectivo",
    }, 500)).toEqual({ received: 500, credit: 0 });
  });

  it("calculates credit for a partial sale", () => {
    expect(paymentValues({
      lines: [{ productId: "p", qty: 1 }],
      paymentKind: "partial",
      customerId: "c",
      amountReceived: 300,
      method: "Nequi",
    }, 500)).toEqual({ received: 300, credit: 200 });
  });

  it("rejects a credit sale with received money", () => {
    expect(() => paymentValues({
      lines: [{ productId: "p", qty: 1 }],
      paymentKind: "credit",
      customerId: "c",
      amountReceived: 1,
    }, 500)).toThrow("La venta fiada no recibe dinero.");
  });
});
