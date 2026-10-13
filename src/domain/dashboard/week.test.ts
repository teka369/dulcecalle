import { describe, expect, it } from "vitest";
import { buildWeekSeries, weekTotal } from "./week";

// 2026-10-13 15:00 Bogota (UTC-5) = 20:00Z, a Tuesday.
const NOW = Date.parse("2026-10-13T20:00:00Z");
const at = (iso: string) => Date.parse(iso);

describe("buildWeekSeries", () => {
  it("returns 7 Bogota days ending today", () => {
    const days = buildWeekSeries([], NOW);
    expect(days.map((d) => d.label)).toEqual([
      "Mié", "Jue", "Vie", "Sáb", "Dom", "Lun", "Mar",
    ]);
    expect(days[6]).toMatchObject({ key: "2026-10-13", isToday: true });
    expect(days[0].key).toBe("2026-10-07");
  });

  it("buckets saleTotal by Bogota day and drops out-of-window sales", () => {
    const days = buildWeekSeries(
      [
        { createdAt: at("2026-10-12T04:30:00Z"), saleTotal: 1000 }, // 11 Oct 23:30 Bogota
        { createdAt: at("2026-10-12T15:00:00Z"), saleTotal: 2500 },
        { createdAt: at("2026-10-12T16:00:00Z"), saleTotal: 500 },
        { createdAt: at("2026-10-01T15:00:00Z"), saleTotal: 9999 },
      ],
      NOW,
    );
    expect(days.find((d) => d.key === "2026-10-11")?.total).toBe(1000);
    expect(days.find((d) => d.key === "2026-10-12")?.total).toBe(3000);
    expect(weekTotal(days)).toBe(4000);
  });

  it("uses the snapshot total for today", () => {
    const days = buildWeekSeries(
      [{ createdAt: NOW - 1000, saleTotal: 100 }],
      NOW,
      184500,
    );
    expect(days[6].total).toBe(184500);
  });
});
