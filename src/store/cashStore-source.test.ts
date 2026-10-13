import { beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkError } from "@/data/errors";
import { cashOfflineView, cashPageGate } from "@/components/cash/cash";

const api = { cash: { today: vi.fn(), expenses: vi.fn() } };
const local = vi.fn();
vi.mock("@/data/pwa/api", () => ({ getPwaApi: () => api }));
vi.mock("@/data/pwa/offline-operations", async (orig) => ({
  ...(await orig<object>()),
  getLocalCashSnapshot: () => local(),
}));

function today(session: unknown = null, moves: unknown[] = []) {
  return {
    localDate: "2026-10-13",
    session,
    expected: { efectivo: 0, nequi: 0, total: 0 },
    closed: false,
    pendingCount: 0,
    pendingSessions: [],
    needsReviewCount: 0,
    moves,
  };
}

async function gateAfterRefresh(online: boolean) {
  const { cashStore } = await import("./cashStore");
  const summary = await cashStore.refresh();
  const hasLocalData = summary.session != null || summary.moves.length > 0 || summary.pendingCount > 0;
  const offlineView = cashOfflineView({ online, preparedAt: null, hasLocalData });
  return {
    source: cashStore.getSnapshot().source,
    gate: cashPageGate({ source: cashStore.getSnapshot().source, loadError: null, offlineView, hasLocalData }),
  };
}

describe("cashStore source + Caja gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("online fetch error/timeout without cache => source local, error (no Abrir caja)", async () => {
    api.cash.today.mockRejectedValue(new NetworkError("timeout"));
    api.cash.expenses.mockRejectedValue(new NetworkError("timeout"));
    local.mockResolvedValue({ summary: { ...today(), entradas: 0, salidas: 0, counted: null, difference: null }, expenses: [] });
    const r = await gateAfterRefresh(true);
    expect(r.source).toBe("local");
    expect(r.gate).toBe("error");
  });

  it("offline without cache => offline state", async () => {
    api.cash.today.mockRejectedValue(new NetworkError("offline"));
    api.cash.expenses.mockRejectedValue(new NetworkError("offline"));
    local.mockResolvedValue({ summary: { ...today(), entradas: 0, salidas: 0, counted: null, difference: null }, expenses: [] });
    expect((await gateAfterRefresh(false)).gate).toBe("offline");
  });

  it("real server response with no caja => ok (Abrir caja offered)", async () => {
    api.cash.today.mockResolvedValue(today());
    api.cash.expenses.mockResolvedValue([]);
    const r = await gateAfterRefresh(true);
    expect(r.source).toBe("server");
    expect(r.gate).toBe("ok");
  });

  it("local fallback with data => ok (shows data)", async () => {
    api.cash.today.mockRejectedValue(new NetworkError("timeout"));
    api.cash.expenses.mockRejectedValue(new NetworkError("timeout"));
    const session = { id: "s1", localDate: "2026-10-13", openedAt: 1, closedAt: null, openingFloat: 0, closingCount: null, expectedEfectivo: null, expectedNequi: null, difference: null };
    local.mockResolvedValue({ summary: { ...today(session), entradas: 0, salidas: 0, counted: null, difference: null }, expenses: [] });
    const r = await gateAfterRefresh(true);
    expect(r.source).toBe("local");
    expect(r.gate).toBe("ok");
  });
});
