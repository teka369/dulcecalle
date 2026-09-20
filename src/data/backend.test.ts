import { describe, expect, it } from "vitest";
import { apiBaseUrl, getDataBackend, pwaStorage } from "./backend";

describe("data backend selection", () => {
  it("PWA talks HTTP on /v1 by default (M3)", () => {
    expect(getDataBackend()).toBe("http");
    expect(pwaStorage()).toBe("http");
    expect(apiBaseUrl()).toBe("/v1");
  });
});
