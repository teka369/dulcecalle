import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/data/errors";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import { resetOutboxStoreSingleton, resetOutboxSyncEngineSingleton } from "@/data/local/outbox";
import { resetLocalStoreSingleton } from "@/data/local/store";
import { resetCatalogReadCache } from "@/data/local/read-cache";
import { getPwaAuthSession } from "@/data/http/session";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import {
  loadDashboardWithOfflineFallback,
  loadStatsWithOfflineFallback,
} from "./offline-snapshots";

const BIZ = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const api = {
  session: { businessId: BIZ },
  dashboardResult: vi.fn(),
  stats: { get: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("./dashboard", () => ({
  loadDashboardResult: () => api.dashboardResult(),
}));

function snap(ventasHoy: number) {
  return {
    snapshot: { businessName: "Tienda", ventasHoy } as unknown as DashboardSnapshot,
    complete: true,
    networkFailure: false,
  };
}

function stats(period = "hoy") {
  return { period, ventas: 100, emptyPeriod: false };
}

describe("offline snapshots", () => {
  beforeEach(async () => {
    resetOutboxStoreSingleton();
    resetOutboxSyncEngineSingleton();
    resetLocalStoreSingleton();
    resetCatalogReadCache();
    await __resetLocalDbForTests();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    api.session.businessId = BIZ;
    getPwaAuthSession().businessId = BIZ;
  });

  it("saves the server snapshot and serves it offline with its capture time", async () => {
    api.dashboardResult.mockResolvedValue(snap(5));
    const first = await loadDashboardWithOfflineFallback();
    expect(first.source).toBe("server");
    api.dashboardResult.mockRejectedValue(new NetworkError("offline"));
    const cached = await loadDashboardWithOfflineFallback();
    expect(cached.source).toBe("cache");
    expect(cached.capturedAt).toBe(first.capturedAt);
    expect((cached.data as unknown as { ventasHoy: number }).ventasHoy).toBe(5);
  });

  it("isolates snapshots per business", async () => {
    api.dashboardResult.mockResolvedValue(snap(1));
    await loadDashboardWithOfflineFallback();
    api.session.businessId = OTHER;
    getPwaAuthSession().businessId = OTHER;
    api.dashboardResult.mockRejectedValue(new NetworkError("offline"));
    await expect(loadDashboardWithOfflineFallback()).rejects.toThrow();
  });

  it("overwrites with every online fetch", async () => {
    api.dashboardResult.mockResolvedValue(snap(1));
    await loadDashboardWithOfflineFallback();
    api.dashboardResult.mockResolvedValue(snap(9));
    const second = await loadDashboardWithOfflineFallback();
    expect((second.data as unknown as { ventasHoy: number }).ventasHoy).toBe(9);
  });

  it("rethrows HTTP errors instead of serving stale data", async () => {
    api.dashboardResult.mockResolvedValue(snap(1));
    await loadDashboardWithOfflineFallback();
    const err = new ApiError("INTERNAL", "Falla.", 500);
    api.dashboardResult.mockRejectedValue(err);
    await expect(loadDashboardWithOfflineFallback()).rejects.toBe(err);
  });

  it("never replaces a complete snapshot with a partial one", async () => {
    api.dashboardResult.mockResolvedValue(snap(5));
    const first = await loadDashboardWithOfflineFallback();
    // Partial result from a real server error: throws, previous intact.
    api.dashboardResult.mockResolvedValue({
      snapshot: { businessName: "Tienda", ventasHoy: 0 } as unknown as DashboardSnapshot,
      complete: false,
      networkFailure: false,
    });
    await expect(loadDashboardWithOfflineFallback()).rejects.toThrow(
      "Respuesta incompleta del servidor.",
    );
    const cached = await loadDashboardWithOfflineFallback().catch(() => null);
    expect(cached).toBeNull();
    const row = await getLocalDb().snapshots.get(`${BIZ}::dashboard`);
    expect((row?.payload as unknown as { ventasHoy: number }).ventasHoy).toBe(5);
    expect(row?.capturedAt).toBe(first.capturedAt);
  });

  it("partial result from transport serves the previous snapshot", async () => {
    api.dashboardResult.mockResolvedValue(snap(5));
    const first = await loadDashboardWithOfflineFallback();
    api.dashboardResult.mockResolvedValue({
      snapshot: { businessName: "Tienda", ventasHoy: 0 } as unknown as DashboardSnapshot,
      complete: false,
      networkFailure: true,
    });
    const cached = await loadDashboardWithOfflineFallback();
    expect(cached.source).toBe("cache");
    expect(cached.capturedAt).toBe(first.capturedAt);
  });

  it("validates dashboard and stats shapes structurally", async () => {
    const { isDashboardSnapshot, isRemoteStats } = await import("./offline-snapshots");
    expect(isDashboardSnapshot(null)).toBe(false);
    expect(isDashboardSnapshot([])).toBe(false);
    expect(isDashboardSnapshot({})).toBe(false);
    expect(
      isDashboardSnapshot({
        greeting: "x", dateLabel: "y", todaySalesTotal: 0, todaySalesCount: 0,
        debtTotal: 0, debtorCount: 0, debtors: [], productCount: 0,
        lowStockCount: 0, lowStock: [], activity: [], cajaState: "open",
        emptyDb: false, actions: [],
      }),
    ).toBe(true);
    expect(isDashboardSnapshot({ greeting: "x" })).toBe(false);
    expect(isRemoteStats({ period: "hoy", ventas: 1, emptyPeriod: false })).toBe(true);
    expect(isRemoteStats({ period: "hoy", ventas: 1 })).toBe(false);
    expect(isRemoteStats(null)).toBe(false);
  });

  it("caches stats per period", async () => {
    api.stats.get.mockImplementation(async (period: string) => stats(period));
    const hoy = await loadStatsWithOfflineFallback("hoy");
    expect(hoy.source).toBe("server");
    api.stats.get.mockRejectedValue(new NetworkError("offline"));
    const cached = await loadStatsWithOfflineFallback("hoy");
    expect(cached.source).toBe("cache");
    expect(cached.data.period).toBe("hoy");
    await expect(loadStatsWithOfflineFallback("mes")).rejects.toThrow();
  });

});

