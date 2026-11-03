import { describe, expect, it } from "vitest";
import { mergeHistory } from "./op-history";
import { otherDayOf } from "./statement";

const op = "aaaaaaaa-1111-4111-8111-111111111111";
const other = "bbbbbbbb-2222-4222-8222-222222222222";

describe("C01.1 history merge (local discardedOps + server trace)", () => {
  const local = [{
    id: op, operationId: op, businessId: "b", entity: "customerPayment" as const, operation: "pay" as const, requestId: op,
    payload: {}, amount: 20000, customerId: null, lastError: "x", rejectionCode: "CLOSED_DAY", state: "discarded" as const,
    replacedBy: null, localCreatedAt: 1, discardedAt: 2,
  }];
  const ev = (operationId: string, kind: "rejected" | "discarded" | "replaced") => ({
    id: operationId + kind, operationId, requestId: null, entity: "customerPayment", operation: "pay", kind, amount: 5000,
    customerId: null, rejectionCode: null, lastError: null, replacedBy: null, deviceCreatedAt: null, createdAt: "2026-11-03T10:00:00.000Z",
  });

  it("one row per operation, marked as backed up when the server has it", () => {
    const rows = mergeHistory(local, [ev(op, "rejected"), ev(op, "discarded")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].backup).toBe("server");
  });
  it("adds rows discarded on another device; ignores bare rejections", () => {
    const rows = mergeHistory(local, [ev(other, "discarded"), ev(other, "rejected"), ev("cccccccc-3333-4333-8333-333333333333", "rejected")]);
    expect(rows.map((r) => [r.operationId, r.backup])).toEqual([[other, "other-device"], [op, "local"]]);
  });
  it("server unreadable keeps local rows as not backed up", () => {
    expect(mergeHistory(local, null)[0].backup).toBe("local");
  });
});

describe("C01.1 «De otro día» against the caja day from the server ledger", () => {
  it("received today but entered yesterday's open caja → badge vs the caja day", () => {
    const occurredAt = new Date(2026, 10, 3, 8, 0).getTime();
    expect(otherDayOf({ occurredAt, occurredOn: "2026-11-03", cajaDay: "2026-11-02" })).toEqual({
      otherDay: { occurredOn: "2026-11-03", appliedOn: "2026-11-02" },
    });
  });
});
