import { describe, expect, it } from "vitest";
import { assertUuid, isUuid, newEntityId, newRequestId } from "./ids";

describe("M6 local ids", () => {
  it("mints UUID entity ids, never Dexie integers", () => {
    const id = newEntityId();
    expect(isUuid(id)).toBe(true);
    expect(typeof id).toBe("string");
    expect(id).not.toMatch(/^\d+$/);
  });

  it("requestId is a stable-shape UUID (retry must reuse the stored value)", () => {
    const id = newRequestId("customer");
    expect(isUuid(id)).toBe(true);
    expect(id).not.toContain("customer");
  });

  it("assertUuid rejects numbers and non-uuid strings", () => {
    expect(() => assertUuid(381, "id")).toThrow(/UUID/);
    expect(() => assertUuid("381", "id")).toThrow(/UUID/);
    expect(() => assertUuid("not-a-uuid", "id")).toThrow(/UUID/);
    const ok = "550e8400-e29b-41d4-a716-446655440000";
    expect(assertUuid(ok, "id")).toBe(ok);
  });
});
