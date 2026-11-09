import { AppError } from "./errors";
import { isOfflineReplay, parseOccurredAt } from "./occurred-at";

describe("parseOccurredAt (C03 / DC-06)", () => {
  const now = new Date("2026-11-09T15:00:00.000Z");

  it("defaults to now when the client omitted the field", () => {
    expect(parseOccurredAt(undefined, now)).toBe(now);
  });

  it("keeps a timestamp from three hours earlier", () => {
    const sent = new Date(now.getTime() - 3 * 3600 * 1000).toISOString();
    expect(parseOccurredAt(sent, now).toISOString()).toBe(sent);
  });

  it("rejects a timestamp more than 5 minutes in the future", () => {
    const future = new Date(now.getTime() + 48 * 3600 * 1000).toISOString();
    try {
      parseOccurredAt(future, now);
      fail("expected VALIDATION");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("VALIDATION");
      expect((e as AppError).message).toMatch(/futuro/);
    }
  });

  it("rejects a timestamp older than 30 days (Decision 16)", () => {
    const tooOld = new Date(now.getTime() - 31 * 24 * 3600 * 1000).toISOString();
    try {
      parseOccurredAt(tooOld, now);
      fail("expected VALIDATION");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("VALIDATION");
      expect((e as AppError).message).toMatch(/30 días/);
    }
  });

  it("accepts a timestamp exactly 30 days back", () => {
    const edge = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
    expect(parseOccurredAt(edge, now).toISOString()).toBe(edge);
  });

  it("rejects an invalid date string", () => {
    expect(() => parseOccurredAt("no-es-una-fecha", now)).toThrow(AppError);
  });
});

describe("isOfflineReplay (Decision 16)", () => {
  it("recognizes common truthy header values", () => {
    expect(isOfflineReplay("true")).toBe(true);
    expect(isOfflineReplay("TRUE")).toBe(true);
    expect(isOfflineReplay("1")).toBe(true);
    expect(isOfflineReplay("yes")).toBe(true);
  });

  it("treats missing or other values as online", () => {
    expect(isOfflineReplay(undefined)).toBe(false);
    expect(isOfflineReplay("")).toBe(false);
    expect(isOfflineReplay("false")).toBe(false);
  });
});
