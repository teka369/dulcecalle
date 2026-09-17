import { describe, expect, it } from "vitest";
import {
  ABONO_ERRORS,
  abonoRemainingHelper,
  validateAbono,
} from "./validate";

describe("validateAbono (exact S2 copy)", () => {
  it("rejects empty amount", () => {
    expect(
      validateAbono({ amountRaw: "", debt: 3000, method: "Efectivo" }),
    ).toBe(ABONO_ERRORS.empty);
    expect(
      validateAbono({ amountRaw: "   ", debt: 3000, method: "Efectivo" }),
    ).toBe(ABONO_ERRORS.empty);
  });

  it("rejects amount <= 0", () => {
    expect(
      validateAbono({ amountRaw: "0", debt: 3000, method: "Efectivo" }),
    ).toBe(ABONO_ERRORS.notPositive);
  });

  it("rejects overpay", () => {
    expect(
      validateAbono({ amountRaw: "3001", debt: 3000, method: "Efectivo" }),
    ).toBe(ABONO_ERRORS.exceedsDebt);
  });

  it("rejects missing method", () => {
    expect(
      validateAbono({ amountRaw: "1000", debt: 3000, method: null }),
    ).toBe(ABONO_ERRORS.noMethod);
  });

  it("accepts partial and total with Efectivo|Nequi", () => {
    expect(
      validateAbono({ amountRaw: "1000", debt: 3000, method: "Efectivo" }),
    ).toBeNull();
    expect(
      validateAbono({ amountRaw: "3000", debt: 3000, method: "Nequi" }),
    ).toBeNull();
  });
});

describe("abonoRemainingHelper", () => {
  it("shows Queda debiendo / Queda en $ 0", () => {
    expect(abonoRemainingHelper(3000, 1000)).toMatch(/^Queda debiendo \$/);
    expect(abonoRemainingHelper(3000, 3000)).toBe("Queda en $ 0");
  });
});
