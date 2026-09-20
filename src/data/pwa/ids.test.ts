import { describe, expect, it } from "vitest";
import { routeId } from "./ids";

const SAMPLE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("PWA routeId (M3)", () => {
  it("accepts a UUID and rejects Dexie integers", () => {
    expect(routeId(SAMPLE)).toBe(SAMPLE);
    expect(routeId([SAMPLE])).toBe(SAMPLE);
    expect(routeId("7")).toBeNull();
    expect(routeId("not-a-uuid")).toBeNull();
    expect(routeId(undefined)).toBeNull();
  });
});
