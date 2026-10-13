import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetLocalDbForTests, getLocalDb } from "@/data/local/db";
import type { LocalSale } from "@/data/local/types";
import { loadWeekSeries, weekHistoryFresh } from "./week-source";

const session = { businessId: "biz-a" as string | null };
vi.mock("@/data/pwa/api", () => ({ getPwaApi: () => ({ session }) }));

const NOW = Date.parse("2026-10-13T20:00:00Z");

function row(id: string, businessId: string, occurredOn: string, saleTotal: number): LocalSale {
  return {
    id,
    businessId,
    customerId: null,
    paymentKind: "paid",
    method: "Efectivo",
    saleTotal,
    amountReceived: saleTotal,
    credit: 0,
    requestId: `req-${id}`,
    note: null,
    occurredOn,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function markReady(businessId: string, cachedAt = NOW) {
  await getLocalDb().cacheMeta.put({
    id: `${businessId}::history:sales`,
    businessId,
    resource: "history:sales",
    cachedAt,
  });
}

describe("loadWeekSeries (dulcecalle-local, read-only)", () => {
  beforeEach(async () => {
    await __resetLocalDbForTests();
    session.businessId = "biz-a";
    await getLocalDb().sales.bulkPut([
      row("a1", "biz-a", "2026-10-08", 1000),
      row("a2", "biz-a", "2026-10-12", 2000),
      row("a3", "biz-a", "2026-10-01", 9999),
      row("b1", "biz-b", "2026-10-12", 50000),
    ]);
  });

  it("returns null (no chart) when sales history is not prepared", async () => {
    expect(await loadWeekSeries(NOW, 500)).toBeNull();
  });

  it("returns past days for the active business only", async () => {
    await markReady("biz-a");
    const days = await loadWeekSeries(NOW, 500);
    expect(days).not.toBeNull();
    const by = Object.fromEntries(days!.map((d) => [d.key, d.total]));
    expect(by["2026-10-08"]).toBe(1000);
    expect(by["2026-10-12"]).toBe(2000);
    expect(by["2026-10-13"]).toBe(500);
    expect(days!.reduce((s, d) => s + d.total, 0)).toBe(3500);
  });

  it("does not use another business's prepared history", async () => {
    await markReady("biz-b");
    expect(await loadWeekSeries(NOW, 500)).toBeNull();
    session.businessId = "biz-b";
    const days = await loadWeekSeries(NOW, 0);
    expect(days!.find((d) => d.key === "2026-10-12")?.total).toBe(50000);
    expect(days!.find((d) => d.key === "2026-10-08")?.total).toBe(0);
  });

  it("shows the chart when history was cached within 24h", async () => {
    await markReady("biz-a", NOW - 23 * 60 * 60 * 1000);
    expect(await loadWeekSeries(NOW, 0)).not.toBeNull();
    await markReady("biz-a", NOW - 24 * 60 * 60 * 1000);
    expect(await loadWeekSeries(NOW, 0)).not.toBeNull();
  });

  it("returns null (Ventas de hoy) when history is older than 24h", async () => {
    await markReady("biz-a", NOW - 24 * 60 * 60 * 1000 - 1);
    expect(await loadWeekSeries(NOW, 0)).toBeNull();
    await markReady("biz-a", NOW - 3 * 24 * 60 * 60 * 1000);
    expect(await loadWeekSeries(NOW, 0)).toBeNull();
  });

  it("treats a future cachedAt (clock skew) as not fresh", async () => {
    await markReady("biz-a", NOW + 60_000);
    expect(await weekHistoryFresh("biz-a", NOW)).toBe(false);
  });

  it("returns null without an active business", async () => {
    session.businessId = null;
    expect(await loadWeekSeries(NOW, 0)).toBeNull();
  });
});
