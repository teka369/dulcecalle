import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("/login hidden 10-tap logo shortcut", () => {
  it("keeps the 10 taps / 2.5 s → /acceso-tienda behavior next to the store-first login", () => {
    const page = readFileSync("src/app/login/page.tsx", "utf8");
    expect(page).toContain("onLogoTap");
    expect(page).toContain("now - at <= 2500");
    expect(page).toContain("taps.length === 10");
    expect(page).toContain('router.push("/acceso-tienda")');
    expect(page).toContain("StoreLoginForm");
  });
});
