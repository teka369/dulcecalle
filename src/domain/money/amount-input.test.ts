import { describe, expect, it } from "vitest";
import { AMOUNT_DECIMAL_MESSAGE, AMOUNT_TOO_LARGE_MESSAGE, MAX_COP_AMOUNT, parseAmountInput } from "./limits";

/** loop/v1 T-alto1 / M1: COP input parsing and a documented ceiling. */
describe("parseAmountInput", () => {
  it("keeps plain digits", () => {
    expect(parseAmountInput("1500")).toEqual({ digits: "1500" });
    expect(parseAmountInput("")).toEqual({ digits: "" });
    expect(parseAmountInput(" $ 2 000 ")).toEqual({ digits: "2000" });
  });
  it("accepts es-CO thousands dots (1.500 = 1500)", () => {
    expect(parseAmountInput("1.500")).toEqual({ digits: "1500" });
    expect(parseAmountInput("1.250.000")).toEqual({ digits: "1250000" });
  });
  it("rejects decimals instead of multiplying by 100", () => {
    expect(parseAmountInput("1500,50")).toEqual({ error: AMOUNT_DECIMAL_MESSAGE });
    expect(parseAmountInput("1.500,5")).toEqual({ error: AMOUNT_DECIMAL_MESSAGE });
    expect(parseAmountInput("1500.5")).toEqual({ error: AMOUNT_DECIMAL_MESSAGE });
    expect(parseAmountInput("1500,")).toEqual({ error: AMOUNT_DECIMAL_MESSAGE });
  });
  it("rejects amounts above the ceiling", () => {
    expect(parseAmountInput(String(MAX_COP_AMOUNT))).toEqual({ digits: String(MAX_COP_AMOUNT) });
    expect(parseAmountInput(String(MAX_COP_AMOUNT + 1))).toEqual({ error: AMOUNT_TOO_LARGE_MESSAGE });
    expect(parseAmountInput("9007199254740991")).toEqual({ error: AMOUNT_TOO_LARGE_MESSAGE });
    expect(parseAmountInput("99999999999999999999")).toEqual({ error: AMOUNT_TOO_LARGE_MESSAGE });
  });
});
