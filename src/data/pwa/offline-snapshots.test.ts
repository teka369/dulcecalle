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
  dashboard: vi.fn(),
  stats: { get: vi.fn() },
};

vi.mock("./api", () => ({ getPwaApi: () => api }));
vi.mock("./dashboard", () => ({
  loadHttpDashboard: () => api.dashboard(),
}));

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
    api.dashboard.mockResolvedValue({ businessName: "Tienda", ventasHoy: 5 } as unknown as DashboardSnapshot);
    const first = await loadDashboardWithOfflineFallback();
    expect(first.source).toBe("server");
    api.dashboard.mockRejectedValue(new NetworkError("offline"));
    const cached = await loadDashboardWithOfflineFallback();
    expect(cached.source).toBe("cache");
    expect(cached.capturedAt).toBe(first.capturedAt);
    expect((cached.data as unknown as { ventasHoy: number }).ventasHoy).toBe(5);
  });

  it("isolates snapshots per business", async () => {
    api.dashboard.mockResolvedValue({ businessName: "A", ventasHoy: 1 } as unknown as DashboardSnapshot);
    await loadDashboardWithOfflineFallback();
    api.session.businessId = OTHER;
    getPwaAuthSession().businessId = OTHER;
    api.dashboard.mockRejectedValue(new NetworkError("offline"));
    await expect(loadDashboardWithOfflineFallback()).rejects.toThrow();
  });

  it("overwrites with every online fetch", async () => {
    api.dashboard.mockResolvedValue({ businessName: "A", ventasHoy: 1 } as unknown as DashboardSnapshot);
    await loadDashboardWithOfflineFallback();
    api.dashboard.mockResolvedValue({ businessName: "A", ventasHoy: 9 } as unknown as DashboardSnapshot);
    const second = await loadDashboardWithOfflineFallback();
    expect((second.data as unknown as { ventasHoy: number }).ventasHoy).toBe(9);
  });

  it("rethrows HTTP errors instead of serving stale data", async () => {
    api.dashboard.mockResolvedValue({ businessName: "A", ventasHoy: 1 } as unknown as DashboardSnapshot);
    await loadDashboardWithOfflineFallback();
    const err = new ApiError("INTERNAL", "Falla.", 500);
    api.dashboard.mockRejectedValue(err);
    await expect(loadDashboardWithOfflineFallback()).rejects.toBe(err);
  });

  it("rejects malformed payloads without caching them", async () => {
    api.dashboard.mockResolvedValue(null);
    await expect(loadDashboardWithOfflineFallback()).rejects.toThrow();
    expect(await getLocalDb().snapshots.count()).toBe(0);
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

