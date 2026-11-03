import { describe, expect, it } from "vitest";
import { otherDayOf } from "./statement";

describe("C01 «De otro día» (otherDayOf)", () => {
  it("flags an abono received on another day than the caja it entered", () => {
    const occurredAt = new Date(2026, 10, 2, 20, 0).getTime();
    expect(otherDayOf({ occurredAt, occurredOn: "2026-11-03" })).toEqual({
      otherDay: { occurredOn: "2026-11-02", appliedOn: "2026-11-03" },
    });
  });
  it("no badge for same-day or legacy payments", () => {
    expect(otherDayOf({ occurredAt: new Date(2026, 10, 3, 8).getTime(), occurredOn: "2026-11-03" })).toEqual({});
    expect(otherDayOf({ occurredOn: "2026-11-03" })).toEqual({});
  });
});
