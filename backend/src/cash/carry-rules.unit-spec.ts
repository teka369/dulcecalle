import { carryModeAllowed, continuityFloat, inCarrySet } from "./carry-rules";
import { linkForNewMove } from "./session-link";
import { occurredOnDate } from "../shared/clock";

describe("carry rules", () => {
  it("rejects counted when later moves are stamped", () => {
    expect(carryModeAllowed("counted", 1)).toEqual({
      ok: false,
      code: "ASSUMED_REQUIRED",
    });
    expect(carryModeAllowed("assumed", 1).ok).toBe(true);
    expect(carryModeAllowed("counted", 0).ok).toBe(true);
  });

  it("does not add the old float onto an already open later session", () => {
    expect(
      continuityFloat({
        mode: "assumed",
        countedEfectivo: null,
        previousExpectedEfectivo: 46000n,
        destinationAlreadyOpen: true,
        destinationOpeningFloat: 10000n,
      }),
    ).toBeNull();
  });

  it("uses the count only when creating continuity", () => {
    expect(
      continuityFloat({
        mode: "counted",
        countedEfectivo: 45000n,
        previousExpectedEfectivo: 46000n,
        destinationAlreadyOpen: false,
        destinationOpeningFloat: null,
      }),
    ).toBe(45000n);
  });

  it("does not adopt an orphan without the stamp", () => {
    expect(
      inCarrySet({
        sessionId: null,
        pendingForSessionId: null,
        occurredOn: "2026-10-07",
        previousId: "old",
        previousLocalDate: "2026-10-06",
        carryLocalDate: "2026-10-10",
      }),
    ).toBe(false);
  });

  it("adopts only the stamped window", () => {
    expect(
      inCarrySet({
        sessionId: null,
        pendingForSessionId: "old",
        occurredOn: "2026-10-08",
        previousId: "old",
        previousLocalDate: "2026-10-06",
        carryLocalDate: "2026-10-10",
      }),
    ).toBe(true);
  });

  it("does not stamp when several sessions are open", () => {
    const link = linkForNewMove(
      [
        { id: "a", localDate: new Date("2026-10-06T00:00:00.000Z") },
        { id: "b", localDate: new Date("2026-10-07T00:00:00.000Z") },
      ],
      new Date("2026-10-10T00:00:00.000Z"),
    );
    expect(link).toEqual({ sessionId: null, pendingForSessionId: null });
  });

  it("stamps the single older open session", () => {
    const link = linkForNewMove(
      [{ id: "a", localDate: new Date("2026-10-06T00:00:00.000Z") }],
      new Date("2026-10-07T00:00:00.000Z"),
    );
    expect(link).toEqual({ sessionId: null, pendingForSessionId: "a" });
  });

  it("cuts the commercial day in America/Bogota", () => {
    expect(
      occurredOnDate("America/Bogota", new Date("2026-10-07T04:59:59.000Z")).toISOString(),
    ).toBe("2026-10-06T00:00:00.000Z");
    expect(
      occurredOnDate("America/Bogota", new Date("2026-10-07T05:00:00.000Z")).toISOString(),
    ).toBe("2026-10-07T00:00:00.000Z");
  });
});
