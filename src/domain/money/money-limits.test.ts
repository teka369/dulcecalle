import { describe, expect, it } from "vitest";
import { validateCashAmount, validateCounted, validateOpeningFloat } from "@/domain/cash/validate";
import { validateAbono } from "@/domain/abono/validate";
import { validateInitialDebtAmount } from "@/domain/initialDebt/validate";
import { asCopJson } from "@/data/http/mappers";

/** loop/v1 T-alto1: behaviour only (no new imports), so it is red on the old code. */
const TOO_LARGE = /demasiado grande/;

describe("validators enforce MAX_COP_AMOUNT", () => {
  it("cash amount / opening / counted / abono", () => {
    expect(validateCashAmount({ amountRaw: "9007199254740991", method: "Efectivo" })).toMatch(TOO_LARGE);
    expect(validateCashAmount({ amountRaw: "100000000", method: "Efectivo" })).toBeNull();
    expect(validateOpeningFloat("9007199254740991")).toMatch(TOO_LARGE);
    expect(validateCounted("9007199254740991")).toMatch(TOO_LARGE);
    expect(validateInitialDebtAmount("9007199254740991")).toMatch(TOO_LARGE);
    expect(validateAbono({ amountRaw: "9007199254740991", method: "Efectivo", debt: Number.MAX_SAFE_INTEGER } as never)).toMatch(TOO_LARGE);
  });
});

describe("out-of-range COP from the server is a controlled error", () => {
  it("asCopJson throws a ContractError with Spanish copy, not a developer string", () => {
    let caught: unknown;
    try {
      asCopJson(9007199254749992, "expected.efectivo");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toMatch(/JSON integer|expected\.efectivo/);
    expect((caught as { detail?: string }).detail).toContain("expected.efectivo");
  });
});
