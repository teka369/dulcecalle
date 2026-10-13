import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpClient } from "@/data/http/client";
import { HttpSession } from "@/data/http/session";
import { cashOfflineView, cashPageGate } from "@/components/cash/cash";

// API that takes 45s to answer: the real HttpClient read timeout must fire first.
const http = new HttpClient("http://x.test/v1", new HttpSession(), (_u, init) =>
  new Promise<Response>((resolve, reject) => {
    const t = setTimeout(() => resolve(new Response("{}", { status: 200 })), 45_000);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(init.signal!.reason);
    });
  }),
);
const api = {
  cash: {
    today: () => http.request("GET", "/cash/today"),
    expenses: () => http.request("GET", "/cash/expenses"),
  },
};
vi.mock("@/data/pwa/api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/pwa/offline-operations", async (orig) => ({
  ...(await orig<object>()),
  getLocalCashSnapshot: async () => ({
    summary: {
      localDate: "2026-10-13", session: null, expected: { efectivo: 0, nequi: 0, total: 0 }, closed: false,
      pendingCount: 0, pendingSessions: [], needsReviewCount: 0, moves: [], entradas: 0, salidas: 0, counted: null, difference: null,
    },
    expenses: [],
  }),
}));

describe("Caja/Gastos with a 45s slow API (online)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("times out at 10s → local fallback → error gate (no Abrir caja, no «Aún no hay gastos»)", async () => {
    const { cashStore } = await import("./cashStore");
    const p = cashStore.refresh();
    await vi.advanceTimersByTimeAsync(10_001);
    const summary = await p;
    const source = cashStore.getSnapshot().source;
    expect(source).toBe("local");
    // Caja
    const cajaLocal = summary.session != null || summary.moves.length > 0 || summary.pendingCount > 0;
    expect(cashPageGate({ source, loadError: null, offlineView: cashOfflineView({ online: true, preparedAt: 1, hasLocalData: cajaLocal }), hasLocalData: cajaLocal })).toBe("error");
    // Gastos
    const gastosLocal = summary.session != null || cashStore.getSnapshot().expenses.length > 0;
    expect(cashPageGate({ source, loadError: null, offlineView: cashOfflineView({ online: true, preparedAt: 1, hasLocalData: gastosLocal }), hasLocalData: gastosLocal })).toBe("error");
  });
});
