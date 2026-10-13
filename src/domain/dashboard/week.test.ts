import { describe, expect, it } from "vitest";
import { bogotaHour, buildWeekSeries, weekStartKey, weekTotal } from "./week";
import { greetingForHour } from "./snapshot";

// 2026-10-13 15:00 Bogota (UTC-5) = 20:00Z, a Tuesday.
const NOW = Date.parse("2026-10-13T20:00:00Z");
const BIZ = "biz-a";
const sale = (occurredOn: string, saleTotal: number, businessId = BIZ) => ({
  businessId,
  occurredOn,
  saleTotal,
});

describe("buildWeekSeries", () => {
  it("returns 7 Bogota days ending today", () => {
    const days = buildWeekSeries([], BIZ, NOW);
    expect(days.map((d) => d.label)).toEqual([
      "Mié", "Jue", "Vie", "Sáb", "Dom", "Lun", "Mar",
    ]);
    expect(days[6]).toMatchObject({ key: "2026-10-13", isToday: true });
    expect(days[0].key).toBe("2026-10-07");
    expect(weekStartKey(NOW)).toBe("2026-10-07");
  });

  it("groups past days by occurredOn and drops out-of-window days", () => {
    const days = buildWeekSeries(
      [
        sale("2026-10-07", 700),
        sale("2026-10-11", 1000),
        sale("2026-10-12", 2500),
        sale("2026-10-12", 500),
        sale("2026-10-06", 9999),
        sale("2026-10-14", 9999),
      ],
      BIZ,
      NOW,
    );
    expect(days.find((d) => d.key === "2026-10-07")?.total).toBe(700);
    expect(days.find((d) => d.key === "2026-10-11")?.total).toBe(1000);
    expect(days.find((d) => d.key === "2026-10-12")?.total).toBe(3000);
    expect(weekTotal(days)).toBe(4700);
  });

  it("ignores sales from other businesses", () => {
    const days = buildWeekSeries(
      [sale("2026-10-12", 1000), sale("2026-10-12", 50000, "biz-b")],
      BIZ,
      NOW,
    );
    expect(days.find((d) => d.key === "2026-10-12")?.total).toBe(1000);
    expect(weekTotal(days)).toBe(1000);
  });

  it("uses the snapshot total for today", () => {
    const days = buildWeekSeries([sale("2026-10-13", 100)], BIZ, NOW, 184500);
    expect(days[6].total).toBe(184500);
  });
});

describe("bogotaHour", () => {
  it("uses America/Bogota regardless of device zone", () => {
    expect(bogotaHour(Date.parse("2026-10-13T20:00:00Z"))).toBe(15);
    expect(bogotaHour(Date.parse("2026-10-14T03:30:00Z"))).toBe(22);
    expect(bogotaHour(Date.parse("2026-10-13T05:00:00Z"))).toBe(0);
    expect(greetingForHour(bogotaHour(Date.parse("2026-10-13T13:00:00Z")))).toBe("Buenos días");
  });
});
