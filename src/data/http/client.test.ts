import { describe, expect, it } from "vitest";
import { HttpClient } from "./client";
import { HttpSession } from "./session";

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
});
