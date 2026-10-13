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
