import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { __resetLocalDbForTests } from "@/data/local/db";
import { HttpRepository } from "@/data/http/repository";
import { HttpSession, getPwaAuthSession } from "@/data/http/session";
import { PREP_READ_TIMEOUT_MS } from "@/data/http/client";
import { loadStatsWithOfflineFallback } from "./offline-snapshots";

const BIZ = "11111111-1111-4111-8111-111111111111";

/** fetch answering after `ms` unless aborted first. */
function slowFetch(ms: number): typeof fetch {
  return (input, init) =>
    new Promise<Response>((resolve, reject) => {
      const url = String(input);
      const period = new URL(url).searchParams.get("period") ?? "hoy";
      const t = setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify({ period, ventas: 7, emptyPeriod: false }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        ms,
      );
      init?.signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
}

function prepRepo(ms: number): HttpRepository {
  const session = new HttpSession(null);
  session.businessId = BIZ;
  session.accessToken = "t";
  return new HttpRepository("http://x.test/v1", session, slowFetch(ms), PREP_READ_TIMEOUT_MS);
}

describe("prep stats snapshot uses the 30s prep deadline", () => {
  beforeEach(async () => {
    await __resetLocalDbForTests();
    getPwaAuthSession().businessId = BIZ;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => vi.useRealTimers());

  for (const period of ["hoy", "semana", "mes"] as const) {
    it(`snapshot:stats:${period} with a 20s response completes`, async () => {
      const p = loadStatsWithOfflineFallback(period, prepRepo(20_000));
      await vi.advanceTimersByTimeAsync(20_001);
      vi.useRealTimers();
      const r = await p;
      expect(r.source).toBe("server");
      expect(r.data.ventas).toBe(7);
    });
  }

  it("a stats response slower than 30s times out with NetworkError", async () => {
    let failed: unknown = null;
    const p = loadStatsWithOfflineFallback("hoy", prepRepo(60_000)).catch((e) => {
      failed = e;
    });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(failed).toBeNull();
    await vi.advanceTimersByTimeAsync(20_000);
    vi.useRealTimers();
    await p;
    expect(failed).toBeInstanceOf(NetworkError);
  });
});
