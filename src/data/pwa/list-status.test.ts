import { describe, expect, it } from "vitest";
import { EMPTY_LIST_STATUS, LIST_STALE_TEXT, listBand, listGate } from "./list-status";

describe("B3 list status", () => {
  it("a failed read with no rows is an error, never empty", () => {
    expect(listGate({ loading: false, count: 0, status: { ...EMPTY_LIST_STATUS, error: "boom" } })).toBe("error");
    expect(listGate({ loading: false, count: 0, status: { source: "server", cachedAt: 1, error: null } })).toBe("empty");
    expect(listGate({ loading: true, count: 0, status: EMPTY_LIST_STATUS })).toBe("loading");
    expect(listGate({ loading: false, count: 0, status: EMPTY_LIST_STATUS })).toBe("loading");
    expect(listGate({ loading: false, count: 3, status: { ...EMPTY_LIST_STATUS, error: "boom" } })).toBe("list");
  });

  it("cache rows get a band: online 'No se pudo actualizar', offline the capture time", () => {
    const cached = { source: "cache" as const, cachedAt: 123, error: null };
    expect(listBand(cached, true, 2)).toEqual({ text: LIST_STALE_TEXT });
    expect(listBand(cached, false, 2)).toEqual({ capturedAt: 123 });
    expect(listBand({ source: "server", cachedAt: 1, error: null }, true, 2)).toBeNull();
    expect(listBand({ source: "server", cachedAt: 1, error: "boom" }, true, 2)).toEqual({ text: LIST_STALE_TEXT });
  });
});
