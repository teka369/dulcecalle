import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCachedBusinessLabel } from "./dashboard";

describe("getCachedBusinessLabel", () => {
  it("is null before any dashboard load (never fetches)", () => {
    expect(getCachedBusinessLabel()).toBeNull();
  });
  it("is used by the Más hero", () => {
    const src = readFileSync(join(__dirname, "../../app/mas/page.tsx"), "utf8");
    expect(src).toContain("getCachedBusinessLabel()");
    expect(src).toContain("${businessLabel} · Caja, gastos y ajustes de la tienda");
  });
});
