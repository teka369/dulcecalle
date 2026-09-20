import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../errors";
import { HttpClient } from "./client";
import { HttpSession } from "./session";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpClient headers", () => {
  it("reuses the same Idempotency-Key on retry of one intent", async () => {
    const keys: string[] = [];
    const session = new HttpSession();
    session.accessToken = "t";
    session.businessId = "b";
    const fetchImpl: typeof fetch = async (_url, init) => {
      const h = init?.headers as Record<string, string>;
      keys.push(h["Idempotency-Key"]);
      return new Response(JSON.stringify({ id: "ok" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    const intent = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await http.request("POST", "/sales", {
      body: { n: 1 },
      idempotencyKey: intent,
    });
    await http.request("POST", "/sales", {
      body: { n: 1 },
      idempotencyKey: intent,
    });
    expect(keys).toEqual([intent, intent]);
  });

  it("sends Authorization and X-Business-Id", async () => {
    let headers: Record<string, string> = {};
    const session = new HttpSession();
    session.accessToken = "tok";
    session.businessId = "biz";
    const fetchImpl: typeof fetch = async (_url, init) => {
      headers = init?.headers as Record<string, string>;
      return new Response("{}", { status: 200 });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    await http.request("GET", "/products");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Business-Id"]).toBe("biz");
  });

  it("does not send X-Business-Id when no business is selected", async () => {
    let headers: Record<string, string> = {};
    const session = new HttpSession();
    session.accessToken = "tok";
    const fetchImpl: typeof fetch = async (_url, init) => {
      headers = init?.headers as Record<string, string>;
      return new Response("{}", { status: 200 });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    await http.request("GET", "/me", { skipBusiness: true });
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["X-Business-Id"]).toBeUndefined();
  });
});

describe("HttpClient 401 → refresh → retry", () => {
  it("refreshes once, retries with the new access token, keeps headers", async () => {
    const session = new HttpSession();
    session.accessToken = "old";
    session.refreshToken = "r1";
    session.businessId = "biz";
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ url: String(url), headers });
      if (String(url).endsWith("/auth/refresh")) {
        expect(headers["X-Business-Id"]).toBeUndefined();
        expect(headers["Content-Type"]).toBe("application/json");
        return jsonResponse(201, {
          accessToken: "new",
          refreshToken: "r2",
        });
      }
      if (headers.Authorization === "Bearer old") {
        return jsonResponse(401, {
          error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
        });
      }
      return jsonResponse(201, { id: "sale-1" });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    const intent = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const body = await http.request<{ id: string }>("POST", "/sales", {
      body: { n: 1 },
      idempotencyKey: intent,
    });
    expect(body.id).toBe("sale-1");
    expect(session.accessToken).toBe("new");
    expect(session.refreshToken).toBe("r2");
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toContain("/sales");
    expect(calls[1].url).toContain("/auth/refresh");
    expect(calls[2].url).toContain("/sales");
    expect(calls[2].headers.Authorization).toBe("Bearer new");
    expect(calls[2].headers["X-Business-Id"]).toBe("biz");
    expect(calls[2].headers["Idempotency-Key"]).toBe(intent);
    expect(calls[2].headers["Content-Type"]).toBe("application/json");
  });

  it("does not refresh on 400/403/404/409", async () => {
    for (const status of [400, 403, 404, 409]) {
      const session = new HttpSession();
      session.accessToken = "tok";
      session.refreshToken = "r1";
      session.businessId = "biz";
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        return jsonResponse(status, {
          error: { code: "NOPE", message: "no" },
        });
      };
      const http = new HttpClient("http://example.test/v1", session, fetchImpl);
      await expect(http.request("GET", "/products")).rejects.toBeInstanceOf(
        ApiError,
      );
      expect(calls).toBe(1);
      expect(session.accessToken).toBe("tok");
      expect(session.refreshToken).toBe("r1");
    }
  });

  it("does not refresh login/register/refresh or customer-access paths", async () => {
    const session = new HttpSession();
    session.refreshToken = "r1";
    for (const path of [
      "/auth/login",
      "/auth/register",
      "/auth/refresh",
      "/customer-access/login",
      "/customer-access/refresh",
      "/customer-access/logout",
    ]) {
      let calls = 0;
      const fetchImpl: typeof fetch = async () => {
        calls += 1;
        return jsonResponse(401, {
          error: { code: "UNAUTHORIZED", message: "No pudimos identificarte." },
        });
      };
      const http = new HttpClient("http://example.test/v1", session, fetchImpl);
      await expect(
        http.request("POST", path, {
          body: { code: "DC-0001", name: "x" },
          skipBusiness: true,
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(calls).toBe(1);
    }
  });

  it("clears the session when refresh fails", async () => {
    const session = new HttpSession();
    session.accessToken = "old";
    session.refreshToken = "bad";
    session.businessId = "biz";
    session.user = { id: "u", email: "a@test.co" };
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        return jsonResponse(401, {
          error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
        });
      }
      return jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
      });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    await expect(http.request("GET", "/products")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
    expect(session.accessToken).toBeNull();
    expect(session.refreshToken).toBeNull();
    expect(session.businessId).toBeNull();
    expect(session.user).toBeNull();
  });

  it("keeps the session when refresh fetch fails with a network error", async () => {
    const session = new HttpSession();
    session.accessToken = "old";
    session.refreshToken = "r1";
    session.businessId = "biz";
    session.user = { id: "u", email: "a@test.co" };
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
    expect(session.accessToken).toBe("old");
    expect(session.refreshToken).toBe("r1");
    expect(session.businessId).toBe("biz");
    expect(session.user).toEqual({ id: "u", email: "a@test.co" });
  });

  it("keeps the session when refresh is aborted", async () => {
    const session = new HttpSession();
    session.accessToken = "old";
    session.refreshToken = "r1";
    session.businessId = "biz";
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      return jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
      });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    await expect(http.request("GET", "/products")).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(session.accessToken).toBe("old");
    expect(session.refreshToken).toBe("r1");
  });

  it("keeps the session when the original fetch fails with a network error", async () => {
    const session = new HttpSession();
    session.accessToken = "tok";
    session.refreshToken = "r1";
    session.businessId = "biz";
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    await expect(http.request("GET", "/products")).rejects.toBeInstanceOf(
      NetworkError,
    );
    expect(session.accessToken).toBe("tok");
    expect(session.refreshToken).toBe("r1");
    expect(session.businessId).toBe("biz");
  });

  it("keeps the session when refresh returns 500", async () => {
    const session = new HttpSession();
    session.accessToken = "old";
    session.refreshToken = "r1";
    session.businessId = "biz";
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        return jsonResponse(500, {
          error: { code: "INTERNAL", message: "Algo salió mal." },
        });
      }
      return jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
      });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    await expect(http.request("GET", "/products")).rejects.toMatchObject({
      status: 500,
    });
    expect(session.accessToken).toBe("old");
    expect(session.refreshToken).toBe("r1");
    expect(session.businessId).toBe("biz");
  });

  it("single-flights concurrent 401s through one refresh", async () => {
    const session = new HttpSession();
    session.accessToken = "old";
    session.refreshToken = "r1";
    let refreshCalls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 40));
        return jsonResponse(201, {
          accessToken: "new",
          refreshToken: "r2",
        });
      }
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Authorization === "Bearer old") {
        return jsonResponse(401, {
          error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
        });
      }
      return jsonResponse(200, []);
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    const [a, b] = await Promise.all([
      http.request("GET", "/products"),
      http.request("GET", "/customers"),
    ]);
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(refreshCalls).toBe(1);
    expect(session.accessToken).toBe("new");
  });

  it("retries only once — no infinite 401 loop", async () => {
    const session = new HttpSession();
    session.accessToken = "old";
    session.refreshToken = "r1";
    let productCalls = 0;
    let refreshCalls = 0;
    const fetchImpl: typeof fetch = async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshCalls += 1;
        return jsonResponse(201, { accessToken: "new", refreshToken: "r2" });
      }
      productCalls += 1;
      return jsonResponse(401, {
        error: { code: "UNAUTHORIZED", message: "Inicia sesión." },
      });
    };
    const http = new HttpClient("http://example.test/v1", session, fetchImpl);
    await expect(http.request("GET", "/products")).rejects.toMatchObject({
      status: 401,
    });
    expect(productCalls).toBe(2);
    expect(refreshCalls).toBe(1);
  });
});
