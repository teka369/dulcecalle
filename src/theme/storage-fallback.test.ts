import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDbForTests } from "@/storage/db";
import { loadMode, loadPalette } from "./storage";

describe("theme load falls back to the cached choice (contraste looked like amber)", () => {
  beforeEach(async () => {
    await __resetDbForTests();
    const map = new Map<string, string>([["dulcecalle.palette", "contraste"], ["dulcecalle.mode", "dark"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("no Dexie row => cached palette/mode, not amber/light", async () => {
    expect(await loadPalette()).toBe("contraste");
    expect(await loadMode()).toBe("dark");
  });
});
