import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HttpClient } from "@/data/http/client";
import { CustomerSession } from "@/data/http/customer-session";
import { HttpSession } from "@/data/http/session";

describe("R2-B M5: session expiry emits dulcecalle:auth-cleared for AuthGate redirect, and /mas/datos calls auth.logout()", () => {
  it("HttpSession.clear() and CustomerSession.clear() dispatch dulcecalle:auth-cleared when refresh fails with 401", async () => {
    const events: string[] = [];
    vi.stubGlobal("window", {
      dispatchEvent: (e: Event) => {
        events.push(e.type);
        return true;
      },
    });
    try {
      const admin = new HttpSession(null);
      admin.accessToken = "old";
      admin.refreshToken = "bad";
      const fetch401: typeof fetch = async () =>
        new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Inicia sesión." } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      const adminClient = new HttpClient("http://example.test/v1", admin, fetch401);
      await expect(adminClient.request("GET", "/products")).rejects.toMatchObject({ status: 401 });
      expect(events).toContain("dulcecalle:auth-cleared");

      events.length = 0;
      const customer = new CustomerSession(null);
      customer.accessToken = "old-c";
      customer.refreshToken = "bad-c";
      const custClient = new HttpClient("http://example.test/v1", customer, fetch401, "/customer-access/refresh");
      await expect(custClient.request("GET", "/customer/me/ledger")).rejects.toMatchObject({ status: 401 });
      expect(events).toContain("dulcecalle:auth-cleared");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("AuthGate listens to AUTH_CLEARED_EVENT and /mas/datos calls getPwaApi().auth.logout()", () => {
    const gate = readFileSync("src/components/shell/AuthGate.tsx", "utf8");
    expect(gate).toContain("AUTH_CLEARED_EVENT");
    const datos = readFileSync("src/app/mas/datos/page.tsx", "utf8");
    expect(datos).toContain("auth.logout()");
  });
});
