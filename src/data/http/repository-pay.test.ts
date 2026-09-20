import { describe, expect, it } from "vitest";
import { HttpRepository } from "./repository";
import { HttpSession } from "./session";
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

describe("HttpRepository customer pay contract", () => {
  it("sends note and Idempotency-Key when recording a payment", async () => {
    const session = new HttpSession(memoryStorage());
    session.accessToken = "acc";
    session.refreshToken = "ref";
    let url = "";
    let headers: Record<string, string> = {};
    let body: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (input, init) => {
      url = String(input);
      headers = (init?.headers ?? {}) as Record<string, string>;
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(201, {
        id: "11111111-1111-4111-8111-111111111111",
        customerId: "22222222-2222-4222-8222-222222222222",
        amount: 1000,
        method: "Efectivo",
        note: "abono semanal",
        occurredOn: "2026-09-20",
        createdAt: "2026-09-20T00:00:00.000Z",
      });
    };
    const repo = new HttpRepository("http://example.test/v1", session, fetchImpl);
    await repo.customers.pay(
      "22222222-2222-4222-8222-222222222222",
      { amount: 1000, method: "Efectivo", note: "abono semanal" },
      "33333333-3333-4333-8333-333333333333",
    );
    expect(url).toContain("/customers/22222222-2222-4222-8222-222222222222/payments");
    expect(headers["Idempotency-Key"]).toBe("33333333-3333-4333-8333-333333333333");
    expect(body).toMatchObject({ amount: 1000, method: "Efectivo", note: "abono semanal" });
  });
});
