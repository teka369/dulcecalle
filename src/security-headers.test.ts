import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

describe("security headers", () => {
  it("CSP: frame-ancestors none, SW allowed, API + Cloudinary + fonts, no unsafe-eval in prod", () => {
    const csp = contentSecurityPolicy({ NODE_ENV: "production", NEXT_PUBLIC_API_URL: "https://api-preview.example.com/v1" });
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toMatch(/connect-src [^;]*https:\/\/dulcecalle-teka369\.onrender\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/api-preview\.example\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/api\.cloudinary\.com/);
    expect(csp).toMatch(/img-src [^;]*https:\/\/res\.cloudinary\.com/);
    expect(csp).toMatch(/style-src [^;]*https:\/\/api\.fontshare\.com/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });
  it("X-Frame-Options DENY and next.config wires the headers for every path", () => {
    expect(securityHeaders({ NODE_ENV: "production" })).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    const cfg = readFileSync("next.config.ts", "utf8");
    expect(cfg).toContain("securityHeaders(");
    expect(cfg).toMatch(/source: "\/:path\*"/);
  });
});
