import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const host = readFileSync(join(__dirname, "EntityViewHost.tsx"), "utf8");
const shell = readFileSync(join(__dirname, "AppShell.tsx"), "utf8");

describe("restored ficha overlay chrome (visual pass soft 1)", () => {
  it("has no extra '← Volver' pill: the hero's back arrow is the only back", () => {
    expect(host).not.toContain("← Volver");
    expect(host).not.toContain("entityViewStore.back()");
  });

  it("the page underneath is not rendered while the overlay is open (single h1)", () => {
    expect(shell).toContain("{overlayOpen ? null : children}");
  });
});
