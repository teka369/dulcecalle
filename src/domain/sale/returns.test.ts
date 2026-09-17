import { describe, expect, it } from "vitest";
import { splitReturnSettlement } from "./returns";

describe("splitReturnSettlement", () => {
  it("credit sale still owed → all debt, no cash", () => {
    expect(
      splitReturnSettlement({
        returnValue: 3_000,
        saleCredit: 5_000,
        alreadyDebtReduced: 0,
        customerDebt: 20_000,
      }),
    ).toEqual({ debtReduced: 3_000, refundAmount: 0 });
  });

  it("paid sale → all cash", () => {
    expect(
      splitReturnSettlement({
        returnValue: 4_000,
        saleCredit: 0,
        alreadyDebtReduced: 0,
        customerDebt: 0,
      }),
    ).toEqual({ debtReduced: 0, refundAmount: 4_000 });
  });

  it("partial: debt first, then cash", () => {
    expect(
      splitReturnSettlement({
        returnValue: 8_000,
        saleCredit: 6_000,
        alreadyDebtReduced: 0,
        customerDebt: 6_000,
      }),
    ).toEqual({ debtReduced: 6_000, refundAmount: 2_000 });
  });

  it("fiada already cobrada (debt 0) → cash refund", () => {
    expect(
      splitReturnSettlement({
        returnValue: 3_000,
        saleCredit: 5_000,
        alreadyDebtReduced: 0,
        customerDebt: 0,
      }),
    ).toEqual({ debtReduced: 0, refundAmount: 3_000 });
  });
});
