import { describe, expect, it } from "vitest";
import { validateOfflinePayment, type CreatePaymentInput } from "./offline-payments";

describe("offline customer payments", () => {
  it("accepts a payment up to the cached debt", () => {
    const input: CreatePaymentInput = {
      customerId: "customer",
      amount: 25_000,
      method: "Efectivo",
    };
    expect(() => validateOfflinePayment(input, 50_000)).not.toThrow();
  });

  it("rejects a payment greater than the cached debt", () => {
    const input: CreatePaymentInput = {
      customerId: "customer",
      amount: 60_000,
      method: "Nequi",
    };
    expect(() => validateOfflinePayment(input, 50_000)).toThrow(
      "El abono no puede ser mayor al saldo.",
    );
  });

  it("rejects non-positive payments", () => {
    const input: CreatePaymentInput = {
      customerId: "customer",
      amount: 0,
      method: "Efectivo",
    };
    expect(() => validateOfflinePayment(input, 50_000)).toThrow(
      "El abono tiene que ser mayor a 0.",
    );
  });
});
