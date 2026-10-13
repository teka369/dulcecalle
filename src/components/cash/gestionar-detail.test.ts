import { describe, expect, it } from "vitest";
import { carryCountedEfectivo, normalizeSessionDetail } from "./gestionar-offline";

type D = { id: string; moves: unknown[]; stampedMoves: unknown[] };
const normalizeDetail = (row: unknown) => normalizeSessionDetail<D>(row);
import { getSyncServerSnapshot } from "@/store/syncStore";

describe("B4 guards", () => {
  it("Gestionar detalle tolerates a session without stampedMoves/moves", () => {
    const d = normalizeDetail({ id: "x", localDate: "2026-10-13" });
    expect(d.stampedMoves).toEqual([]);
    expect(d.moves).toEqual([]);
    expect(normalizeDetail({ id: "x", moves: [{ id: "m" }], stampedMoves: null }).moves).toHaveLength(1);
  });

  it("sync pill SSR/hydration snapshot is fixed and online (no #418 text mismatch)", () => {
    expect(getSyncServerSnapshot()).toBe(getSyncServerSnapshot());
    expect(getSyncServerSnapshot().online).toBe(true);
    expect(getSyncServerSnapshot().counts.total).toBe(0);
  });
});

describe("B9 pasar saldo counted cash", () => {
  it("never sends an implicit 0: empty/invalid -> null (button disabled)", () => {
    expect(carryCountedEfectivo("counted", "")).toBeNull();
    expect(carryCountedEfectivo("counted", "   ")).toBeNull();
    expect(carryCountedEfectivo("counted", "abc")).toBeNull();
    expect(carryCountedEfectivo("counted", "-5")).toBeNull();
  });
  it("explicit amounts pass through (prefilled expected or typed, incl. a typed 0)", () => {
    expect(carryCountedEfectivo("counted", "14700")).toBe(14700);
    expect(carryCountedEfectivo("counted", "0")).toBe(0);
  });
  it("assumed carry sends no counted amount", () => {
    expect(carryCountedEfectivo("assumed", "")).toBeUndefined();
    expect(carryCountedEfectivo("assumed", "500")).toBeUndefined();
  });
});
