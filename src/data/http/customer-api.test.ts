import { describe, expect, it } from "vitest";
import { CustomerApi } from "./customer-api";
import { CustomerSession } from "./customer-session";
import type { AuthStorage } from "./session";

function memoryStorage(): AuthStorage {
  const map = new Map<string, string>();
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

describe("CustomerApi", () => {
  it("logs in without X-Business-Id and persists the customer session", async () => {
    const session = new CustomerSession(memoryStorage());
    let headers: Record<string, string> = {};
    let url = "";
    const fetchImpl: typeof fetch = async (input, init) => {
      url = String(input);
      headers = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse(201, {
        customer: { id: "c1", code: "DC-0001", name: "Rosa", debt: 0 },
        accessToken: "acc",
        refreshToken: "ref",
      });
    };
    const api = new CustomerApi("http://example.test/v1", session, fetchImpl);
    await api.login("DC-0001", "Rosa");
    expect(url).toContain("/customer-access/login");
    expect(headers["X-Business-Id"]).toBeUndefined();
    expect(session.accessToken).toBe("acc");
    expect(session.refreshToken).toBe("ref");
    expect(session.customer).toEqual({
      id: "c1",
      code: "DC-0001",
      name: "Rosa",
    });
  });

  it("surfaces identification errors and does not refresh login", async () => {
    const session = new CustomerSession(memoryStorage());
    session.refreshToken = "leftover";
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "No pudimos identificarte." },
      });
    };
    const api = new CustomerApi("http://example.test/v1", session, fetchImpl);
    await expect(api.login("DC-0001", "Nadie")).rejects.toMatchObject({
      status: 401,
      message: "No pudimos identificarte.",
    });
    expect(calls).toBe(1);
  });

  it("refreshes customer tokens on /customer-access/refresh, not /auth/refresh", async () => {
    const session = new CustomerSession(memoryStorage());
    session.accessToken = "old";
    session.refreshToken = "r1";
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      urls.push(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.endsWith("/customer-access/refresh")) {
        expect(headers["X-Business-Id"]).toBeUndefined();
        return jsonResponse(201, { accessToken: "new", refreshToken: "r2" });
      }
      if (headers.Authorization === "Bearer old") {
        return jsonResponse(401, {
          error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
        });
      }
      return jsonResponse(200, {
        id: "c1",
        code: "DC-0001",
        name: "Rosa",
        debt: 0,
        createdAt: "2026-09-19T00:00:00.000Z",
      });
    };
    const api = new CustomerApi("http://example.test/v1", session, fetchImpl);
    const me = await api.me();
    expect(me.code).toBe("DC-0001");
    expect(session.accessToken).toBe("new");
    expect(urls.some((u) => u.endsWith("/auth/refresh"))).toBe(false);
    expect(urls.some((u) => u.endsWith("/customer-access/refresh"))).toBe(true);
  });

  it("logout clears the session even if the request fails", async () => {
    const session = new CustomerSession(memoryStorage());
    session.accessToken = "acc";
    session.refreshToken = "ref";
    session.customer = { id: "c1", code: "DC-0001", name: "Rosa" };
    const api = new CustomerApi("http://example.test/v1", session, async () =>
      jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
      }),
    );
    await api.logout();
    expect(session.authenticated).toBe(false);
    expect(session.customer).toBeNull();
  });
});
