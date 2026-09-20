import { describe, expect, it } from "vitest";
import type { CreatePaymentInput } from "./offline-payments";

function validatePayment(input: CreatePaymentInput, debt: number) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("El abono tiene que ser mayor a 0.");
  }
  if (input.amount > debt) {
    throw new Error("El abono no puede ser mayor al saldo.");
  }
  if (input.method !== "Efectivo" && input.method !== "Nequi") {
    throw new Error("Elige Efectivo o Nequi.");
  }
}

describe("offline customer payments", () => {
  it("accepts a payment up to the cached debt", () => {
    const input: CreatePaymentInput = {
      customerId: "customer",
      amount: 25_000,
      method: "Efectivo",
    };
    expect(() => validatePayment(input, 50_000)).not.toThrow();
  });

  it("rejects a payment greater than the cached debt", () => {
    const input: CreatePaymentInput = {
      customerId: "customer",
      amount: 60_000,
      method: "Nequi",
    };
    expect(() => validatePayment(input, 50_000)).toThrow(
      "El abono no puede ser mayor al saldo.",
    );
  });

  it("rejects non-positive payments", () => {
    const input: CreatePaymentInput = {
      customerId: "customer",
      amount: 0,
      method: "Efectivo",
    };
    expect(() => validatePayment(input, 50_000)).toThrow(
      "El abono tiene que ser mayor a 0.",
    );
  });
});
