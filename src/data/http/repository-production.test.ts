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

const SOURCE = "33333333-3333-4333-8333-333333333333";
const TARGET = "44444444-4444-4333-8333-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";

function captureFetch(responseBody: unknown) {
  let url = "";
  let headers: Record<string, string> = {};
  let body: Record<string, unknown> = {};
  const fetchImpl: typeof fetch = async (input, init) => {
    url = String(input);
    headers = (init?.headers ?? {}) as Record<string, string>;
    body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    return jsonResponse(201, responseBody);
  };
  return {
    fetchImpl,
    sent: () => ({ url, headers, body }),
  };
}

function remotePrep() {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    sourceId: SOURCE,
    targetId: TARGET,
    sourceName: "Combo",
    targetName: "Terminada",
    qty: 10,
    unitCost: 200,
    note: null,
    occurredOn: "2026-09-23",
    createdAt: "2026-09-23T12:00:00.000Z",
  };
}

describe("HttpRepository production contract", () => {
  it("prepare sends requestId in body AND Idempotency-Key header", async () => {
    const captured = captureFetch(remotePrep());
    const session = new HttpSession(memoryStorage());
    session.accessToken = "acc";
    session.refreshToken = "ref";
    session.businessId = "11111111-1111-4111-8111-111111111111";
    const repo = new HttpRepository("http://example.test/v1", session, captured.fetchImpl);
    const result = await repo.production.prepare(
      { sourceId: SOURCE, targetId: TARGET, qty: 10, unitCost: 200 },
      REQUEST,
    );
    const { url, headers, body } = captured.sent();
    expect(url).toBe("http://example.test/v1/preparations");
    expect(body.requestId).toBe(REQUEST);
    expect(headers["Idempotency-Key"]).toBe(REQUEST);
    expect(result.id).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("list builds source/target query params", async () => {
    const captured = captureFetch([remotePrep()]);
    const session = new HttpSession(memoryStorage());
    session.accessToken = "acc";
    session.refreshToken = "ref";
    const repo = new HttpRepository("http://example.test/v1", session, captured.fetchImpl);
    const rows = await repo.production.list({ sourceId: SOURCE });
    expect(captured.sent().url).toBe(
      `http://example.test/v1/preparations?sourceId=${SOURCE}`,
    );
    expect(rows).toHaveLength(1);
  });
});
