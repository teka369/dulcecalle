import { describe, expect, it } from "vitest";
import { payloadBoundRequestId } from "./requestId";

describe("payloadBoundRequestId (C02)", () => {
  it("keeps the id for an unchanged retry and mints a new one when the payload changes", () => {
    const a = payloadBoundRequestId(null, '{"amount":5000}');
    expect(payloadBoundRequestId(a, '{"amount":5000}').id).toBe(a.id);
    const b = payloadBoundRequestId(a, '{"amount":7000}');
    expect(b.id).not.toBe(a.id);
    expect(payloadBoundRequestId(b, '{"amount":5000}').id).not.toBe(a.id);
  });
});
