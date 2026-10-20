import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Guard for the offline bounce fix: no automatic reload on "online".
describe("next.config Serwist options", () => {
  it("disables reloadOnOnline (a reload of the old page cancels offline navigations)", () => {
    const cfg = readFileSync("next.config.ts", "utf8");
    expect(cfg).toMatch(/reloadOnOnline:\s*false/);
  });
});
