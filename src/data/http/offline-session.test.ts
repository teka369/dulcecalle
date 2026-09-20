import { describe, expect, it } from "vitest";
import { NetworkError } from "../errors";
import { decideAuthGate } from "@/components/shell/auth-gate-decision";
import { HttpClient } from "./client";
import { CustomerApi } from "./customer-api";
import { CustomerSession } from "./customer-session";
import { HttpRepository } from "./repository";
import {
  AUTH_STORAGE_KEY,
  HttpSession,
  type AuthStorage,
} from "./session";

function memoryStorage(initial?: Record<string, string>): AuthStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("M6.2 offline session continuity", () => {
  it("A. login online persists tokens + businessId and never a password", async () => {
    const storage = memoryStorage();
    const session = new HttpSession(storage);
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/auth/login")) {
        const sent = JSON.parse(String(init?.body)) as { password?: string };
        expect(sent.password).toBe("secret12");
        return jsonResponse(201, {
          user: { id: "u1", email: "a@test.co" },
          accessToken: "acc",
          refreshToken: "ref",
        });
      }
      if (String(url).endsWith("/me")) {
        return jsonResponse(200, {
          id: "u1",
          email: "a@test.co",
          memberships: [
            {
              businessId: "biz-a",
              role: "owner",
              business: {
                id: "biz-a",
                name: "Dulce",
                timezone: "America/Bogota",
              },
            },
          ],
        });
      }
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "no" } });
    };
    const repo = new HttpRepository("http://example.test/v1", session, fetchImpl);
    await repo.auth.login("a@test.co", "secret12");
    expect(session.authenticated).toBe(true);
    expect(session.accessToken).toBe("acc");
    expect(session.refreshToken).toBe("ref");
    expect(session.businessId).toBe("biz-a");
    const persisted = JSON.parse(storage.getItem(AUTH_STORAGE_KEY)!) as Record<
      string,
      unknown
    >;
    expect(persisted).not.toHaveProperty("password");
    expect(JSON.stringify(persisted)).not.toMatch(/secret12|password/i);

    const reloaded = new HttpSession(storage);
    expect(reloaded.user).toEqual({ id: "u1", email: "a@test.co" });
    expect(reloaded.businessId).toBe("biz-a");
  });

  it("B. existing session + NetworkError does not clear tokens", async () => {
    const session = new HttpSession();
    session.accessToken = "tok";
    session.refreshToken = "r1";
    session.businessId = "biz-a";
    session.user = { id: "u", email: "a@test.co" };
    const http = new HttpClient("http://example.test/v1", session, async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(http.request("GET", "/products")).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(session.authenticated).toBe(true);
    expect(session.accessToken).toBe("tok");
    expect(session.refreshToken).toBe("r1");
    expect(session.businessId).toBe("biz-a");
  });

  it("C. expired access + offline refresh keeps the session", async () => {
    const session = new HttpSession();
    session.accessToken = "expired";
    session.refreshToken = "r1";
    session.businessId = "biz-a";
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
      });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    await expect(http.request("GET", "/products")).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(session.authenticated).toBe(true);
    expect(session.refreshToken).toBe("r1");
    expect(session.businessId).toBe("biz-a");
  });

  it("D. refresh 401/403 clears the session", async () => {
    for (const status of [401, 403]) {
      const session = new HttpSession();
      session.accessToken = "old";
      session.refreshToken = "bad";
      session.businessId = "biz-a";
      session.user = { id: "u", email: "a@test.co" };
      const fetchImpl: typeof fetch = async (url) => {
        if (String(url).endsWith("/auth/refresh")) {
          return jsonResponse(status, {
            error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
          });
        }
        return jsonResponse(401, {
          error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
        });
      };
      const http = new HttpClient("http://example.test/v1", session, fetchImpl);
      await expect(http.request("GET", "/products")).rejects.toMatchObject({
        status,
      });
      expect(session.authenticated).toBe(false);
      expect(session.accessToken).toBeNull();
      expect(session.refreshToken).toBeNull();
      expect(session.businessId).toBeNull();
    }
  });

  it("E. never-authenticated + offline does not invent a session", async () => {
    const storage = memoryStorage();
    const session = new HttpSession(storage);
    expect(session.authenticated).toBe(false);
    const http = new HttpClient("http://example.test/v1", session, async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      http.request("POST", "/auth/login", {
        body: { email: "a@test.co", password: "x" },
        skipBusiness: true,
        skipRefresh: true,
      }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(session.authenticated).toBe(false);
    expect(storage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: session.authenticated,
        adminBusinessId: session.businessId,
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "redirect", to: "/login" });
  });

  it("F. local session keeps its businessId and does not become another tenant", async () => {
    const storage = memoryStorage();
    const session = new HttpSession(storage);
    session.accessToken = "tok";
    session.refreshToken = "r1";
    session.businessId = "biz-a";
    const reloaded = new HttpSession(storage);
    expect(reloaded.businessId).toBe("biz-a");
    expect(reloaded.businessId).not.toBe("biz-b");
    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: reloaded.authenticated,
        adminBusinessId: reloaded.businessId,
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("G. admin and customer sessions stay on separate keys and routes", async () => {
    const storage = memoryStorage();
    const admin = new HttpSession(storage);
    admin.accessToken = "admin-acc";
    admin.refreshToken = "admin-ref";
    admin.businessId = "biz-a";
    const customer = new CustomerSession(storage);
    customer.accessToken = "cust-acc";
    customer.refreshToken = "cust-ref";
    customer.customer = { id: "c1", code: "DC-0001", name: "Rosa" };

    const rawAdmin = JSON.parse(storage.getItem(AUTH_STORAGE_KEY)!) as Record<
      string,
      unknown
    >;
    expect(rawAdmin.accessToken).toBe("admin-acc");
    expect(rawAdmin).not.toHaveProperty("customer");
    expect(JSON.parse(storage.getItem("dulcecalle.customer.auth")!).accessToken).toBe(
      "cust-acc",
    );

    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: admin.authenticated,
        adminBusinessId: admin.businessId,
        customerAuthenticated: customer.authenticated,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      decideAuthGate({
        pathname: "/cliente",
        adminAuthenticated: admin.authenticated,
        adminBusinessId: admin.businessId,
        customerAuthenticated: false,
      }),
    ).toEqual({ kind: "redirect", to: "/cliente/login" });
    expect(
      decideAuthGate({
        pathname: "/",
        adminAuthenticated: false,
        adminBusinessId: null,
        customerAuthenticated: customer.authenticated,
      }),
    ).toEqual({ kind: "redirect", to: "/login" });

    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/customer-access/refresh")) {
        throw new TypeError("Failed to fetch");
      }
      return jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
      });
    };
    const api = new CustomerApi("http://example.test/v1", customer, fetchImpl);
    await expect(api.me()).rejects.toBeInstanceOf(NetworkError);
    expect(customer.authenticated).toBe(true);
    expect(customer.refreshToken).toBe("cust-ref");
    expect(admin.businessId).toBe("biz-a");
  });
});
