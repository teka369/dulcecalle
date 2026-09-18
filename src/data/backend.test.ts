import { describe, expect, it } from "vitest";
import { apiBaseUrl, getDataBackend, pwaStorage } from "./backend";

describe("data backend selection", () => {
  it("defaults to dexie and never auto-enables HTTP for the PWA", () => {
    expect(getDataBackend()).toBe("dexie");
    expect(pwaStorage()).toBe("dexie");
    expect(apiBaseUrl()).toBeUndefined();
  });
});
