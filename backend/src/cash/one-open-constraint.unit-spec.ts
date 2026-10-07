import { isOneOpenConstraint } from "./cash.service";

describe("one-open constraint", () => {
  it("maps only the one-open index to the pending case", () => {
    expect(
      isOneOpenConstraint({
        message: "Unique constraint failed on the constraint: cash_sessions_one_open_per_business",
        meta: { target: ["business_id"] },
      }),
    ).toBe(true);
  });

  it("does not treat another unique constraint as the one-open index", () => {
    expect(
      isOneOpenConstraint({
        message: "Unique constraint failed on the fields: (`business_id`,`local_date`)",
        meta: { target: ["businessId", "localDate"] },
      }),
    ).toBe(false);
    expect(
      isOneOpenConstraint({
        message: "Unique constraint failed on the fields: (`business_id`,`request_id`)",
        meta: { target: ["businessId", "requestId"] },
      }),
    ).toBe(false);
  });
});
