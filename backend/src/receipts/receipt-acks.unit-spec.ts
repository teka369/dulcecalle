import { deriveAckState } from "./receipt-acks";

describe("C09 deriveAckState (P-C09-14: a dispute stays in reconciliation)", () => {
  const ack = (id: string) => ({ id, kind: "acknowledged" as const });
  const rep = (id: string) => ({ id, kind: "reported_issue" as const });

  it("none → pending; acknowledge only → acknowledged", () => {
    expect(deriveAckState([])).toBe("pending");
    expect(deriveAckState([ack("a")])).toBe("acknowledged");
  });

  it("an open report wins in any order", () => {
    expect(deriveAckState([rep("r"), ack("a")])).toBe("reported");
    expect(deriveAckState([ack("a"), rep("r")])).toBe("reported");
  });

  it("a resolved report no longer holds the state (future owner / C08 resolution)", () => {
    expect(deriveAckState([rep("r"), ack("a")], new Set(["r"]))).toBe("acknowledged");
    expect(deriveAckState([rep("r")], new Set(["r"]))).toBe("pending");
    expect(deriveAckState([rep("r1"), rep("r2")], new Set(["r1"]))).toBe("reported");
  });
});
