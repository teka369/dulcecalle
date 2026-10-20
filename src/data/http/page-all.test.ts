import { describe, expect, it } from "vitest";
import { pageAll } from "./repository";

describe("pageAll (client side of the paged history lists)", () => {
  it("walks pages by cursor until a short page and keeps the base filters", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ id: `r${i}` }));
    const seen: string[] = [];
    const out = await pageAll(
      async (qs) => {
        seen.push(qs);
        const q = new URLSearchParams(qs.slice(1));
        const start = q.get("cursor") ? rows.findIndex((r) => r.id === q.get("cursor")) + 1 : 0;
        return rows.slice(start, start + Number(q.get("limit")));
      },
      new URLSearchParams({ from: "2026-10-01" }),
      3,
    );
    expect(out.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    expect(seen).toEqual(["?from=2026-10-01&limit=3", "?from=2026-10-01&limit=3&cursor=r2", "?from=2026-10-01&limit=3&cursor=r5"]);
  });
  it("an old server that ignores limit/cursor (returns everything each time): no duplicates, stops after one repeat", async () => {
    let calls = 0;
    const all = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const out = await pageAll(async () => {
      calls += 1;
      return all;
    }, undefined, 2);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(calls).toBe(2);
  });
});
