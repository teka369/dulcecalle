import { describe, expect, it } from "vitest";
import { normalizeSessionDetail } from "./gestionar-offline";

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
