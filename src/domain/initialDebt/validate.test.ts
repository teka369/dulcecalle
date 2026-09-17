import { describe, expect, it } from "vitest";
import {
  INITIAL_DEBT_ERRORS,
  validateInitialDebtAmount,
} from "./validate";

describe("validateInitialDebtAmount", () => {
  it("rejects empty / NaN", () => {
    expect(validateInitialDebtAmount("")).toBe(INITIAL_DEBT_ERRORS.empty);
    expect(validateInitialDebtAmount("   ")).toBe(INITIAL_DEBT_ERRORS.empty);
    expect(validateInitialDebtAmount("abc")).toBe(INITIAL_DEBT_ERRORS.empty);
  });

  it("rejects 0 and negatives", () => {
    expect(validateInitialDebtAmount("0")).toBe(INITIAL_DEBT_ERRORS.notPositive);
    expect(validateInitialDebtAmount("-100")).toBe(INITIAL_DEBT_ERRORS.notPositive);
  });

  it("accepts a positive integer", () => {
    expect(validateInitialDebtAmount("16800")).toBeNull();
    expect(validateInitialDebtAmount("500")).toBeNull();
  });
});
