import { describe, expect, it } from "vitest";
import { bogotaKey, dayHeading, groupByDay, saleDayKey, saleTime, ventasSheetState, ventasHero, ventasErrorMessage } from "./sales-list";

describe("sales list helpers", () => {
  it("uses occurredOn, else Bogotá day of createdAt", () => {
    expect(saleDayKey({ occurredOn: "2026-10-12" })).toBe("2026-10-12");
    expect(saleDayKey({ createdAt: Date.parse("2026-10-14T03:30:00Z") })).toBe("2026-10-13");
    expect(bogotaKey(Date.parse("2026-10-13T05:00:00Z"))).toBe("2026-10-13");
  });

  it("formats headings and time in es-CO / Bogotá", () => {
    expect(dayHeading("2026-10-13", "2026-10-13").toLowerCase()).toMatch(/^hoy · mar 13 oct/);
    expect(dayHeading("2026-10-12", "2026-10-13").toLowerCase()).toMatch(/^lun 12 oct/);
    expect(saleTime(Date.parse("2026-10-13T15:42:00Z"))).toMatch(/10:42/);
  });

  it("groups by day keeping order", () => {
    const g = groupByDay([
      { id: 1, occurredOn: "2026-10-13" },
      { id: 2, occurredOn: "2026-10-12" },
      { id: 3, occurredOn: "2026-10-13" },
    ]);
    expect(g.map((x) => [x.key, x.rows.map((r) => r.id)])).toEqual([
      ["2026-10-13", [1, 3]],
      ["2026-10-12", [2]],
    ]);
  });
});

describe("ventasSheetState", () => {
  it("error with no data shows the error (Reintentar), not the filter-empty state", () => {
    expect(ventasSheetState({ ready: true, error: "Sin red", salesCount: 0, filteredCount: 0 })).toBe("error");
  });
  it("error with data keeps the list; loading/empty/filter-empty otherwise", () => {
    expect(ventasSheetState({ ready: true, error: "x", salesCount: 3, filteredCount: 3 })).toBe("list");
    expect(ventasSheetState({ ready: false, error: null, salesCount: 0, filteredCount: 0 })).toBe("loading");
    expect(ventasSheetState({ ready: true, error: null, salesCount: 0, filteredCount: 0 })).toBe("empty");
    expect(ventasSheetState({ ready: true, error: null, salesCount: 2, filteredCount: 0 })).toBe("filter-empty");
  });
});

describe("ventasHero: never a partial total that reads as complete", () => {
  it("skeleton while loading, total from server, note for local rows, nothing on error", () => {
    expect(ventasHero({ ready: false, fromCache: false, salesCount: 0, error: null })).toBe("skeleton");
    expect(ventasHero({ ready: true, fromCache: false, salesCount: 3, error: null })).toBe("total");
    expect(ventasHero({ ready: true, fromCache: true, salesCount: 2, error: null })).toBe("local");
    expect(ventasHero({ ready: true, fromCache: false, salesCount: 0, error: "x" })).toBe("none");
  });
});

describe("ventasErrorMessage", () => {
  it("online timeout reads 'No se pudo cargar.', offline keeps 'Sin conexión.'", () => {
    expect(ventasErrorMessage(new Error("Sin conexión."), true)).toBe("No se pudo cargar.");
    expect(ventasErrorMessage(new Error("Sin conexión."), false)).toBe("Sin conexión.");
  });
});
