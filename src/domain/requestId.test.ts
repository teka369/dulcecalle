import { describe, expect, it } from "vitest";
import { isUuid, newEntityId, newRequestId } from "./requestId";

describe("newRequestId (M6.0)", () => {
  it("returns a UUID, never a Dexie int or Date.now fallback", () => {
    const id = newRequestId("sale");
    expect(isUuid(id)).toBe(true);
    expect(typeof id).toBe("string");
    expect(Number.isInteger(Number(id))).toBe(false);
    expect(id.includes("sale")).toBe(false);
    expect(id).not.toMatch(/^(sale|surtir|dev|gasto)-\d+-/);
  });

  it("does not reuse the previous value (retries must store it)", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
  });

  it("newEntityId is a UUID, same shape as requestId", () => {
    const id = newEntityId();
    expect(isUuid(id)).toBe(true);
    expect(typeof id).not.toBe("number");
  });
});
