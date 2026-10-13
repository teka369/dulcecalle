import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "../errors";
import { HttpClient, READ_TIMEOUT_MS } from "./client";
import { HttpSession } from "./session";

/** fetch that never settles unless aborted (records the signal it got). */
function hangingFetch(seen: Array<AbortSignal | undefined>): typeof fetch {
  return (_url, init) => {
    seen.push(init?.signal ?? undefined);
    return new Promise<Response>(() => undefined);
  };
}

describe("HttpClient read timeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a GET slower than 10s throws NetworkError", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const http = new HttpClient("http://x.test/v1", new HttpSession(), hangingFetch(seen));
    const p = http.request("GET", "/cash/today");
    const assertion = expect(p).rejects.toBeInstanceOf(NetworkError);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);
    await assertion;
    expect(READ_TIMEOUT_MS).toBe(10_000);
    expect(seen[0]?.aborted).toBe(true);
  });

  it("a GET answered before 10s is unaffected", async () => {
    const http = new HttpClient("http://x.test/v1", new HttpSession(), async () =>
      new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    );
    await expect(http.request("GET", "/x")).resolves.toEqual({ ok: 1 });
  });

  it("a POST has no timeout and no signal", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const http = new HttpClient("http://x.test/v1", new HttpSession(), hangingFetch(seen));
    let settled = false;
    void http.request("POST", "/sales", { body: { n: 1 } }).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    expect(seen[0]).toBeUndefined();
  });
});

import { PREP_READ_TIMEOUT_MS } from "./client";
import { HttpRepository } from "./repository";

describe("prep read deadline (30s)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a prep GET survives 10s and fails at 30s with NetworkError", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const http = new HttpClient("http://x.test/v1", new HttpSession(), hangingFetch(seen), undefined, PREP_READ_TIMEOUT_MS);
    let failed: unknown = null;
    const p = http.request("GET", "/sales").catch((e) => {
      failed = e;
    });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(failed).toBeNull();
    expect(seen[0]?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    await p;
    expect(failed).toBeInstanceOf(NetworkError);
  });

  it("per-request timeoutMs overrides the default", async () => {
    const http = new HttpClient("http://x.test/v1", new HttpSession(), hangingFetch([]));
    let failed: unknown = null;
    const p = http.request("GET", "/x", { timeoutMs: PREP_READ_TIMEOUT_MS }).catch((e) => {
      failed = e;
    });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(failed).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    await p;
    expect(failed).toBeInstanceOf(NetworkError);
  });

  it("a normal repository GET still times out at 10s; prep repository at 30s", async () => {
    const normal = new HttpRepository("http://x.test/v1", new HttpSession(), hangingFetch([]));
    const prep = new HttpRepository("http://x.test/v1", new HttpSession(), hangingFetch([]), PREP_READ_TIMEOUT_MS);
    let nErr: unknown = null;
    let pErr: unknown = null;
    const a = normal.products.list().catch((e) => (nErr = e));
    const b = prep.products.list().catch((e) => (pErr = e));
    await vi.advanceTimersByTimeAsync(10_001);
    await a;
    expect(nErr).toBeInstanceOf(NetworkError);
    expect(pErr).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    await b;
    expect(pErr).toBeInstanceOf(NetworkError);
  });

  it("a POST on the prep client has no deadline either", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const http = new HttpClient("http://x.test/v1", new HttpSession(), hangingFetch(seen), undefined, PREP_READ_TIMEOUT_MS);
    let settled = false;
    void http.request("POST", "/sales", { body: {} }).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);
    expect(seen[0]).toBeUndefined();
  });
});

describe("offline prep uses the 30s API", () => {
  it("prep downloads go through getPrepPwaApi", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const prep = readFileSync(join(__dirname, "../pwa/offline-prep.ts"), "utf8");
    const hist = readFileSync(join(__dirname, "../pwa/offline-history.ts"), "utf8");
    expect(prep).toContain("listCachedProducts(getPrepPwaApi())");
    expect(prep).toContain("loadDashboardWithOfflineFallback(getPrepPwaApi())");
    expect(hist).not.toContain("getPwaApi()");
    expect(prep).toContain("PREP_VERSION = 9");
  });
});
