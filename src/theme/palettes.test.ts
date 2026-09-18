import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "@/storage/db";
import {
  DEFAULT_PALETTE,
  PALETTE_IDS,
  PALETTE_META,
  parsePalette,
} from "./palettes";
import { loadPalette, savePalette } from "./storage";

describe("palette system", () => {
  beforeEach(async () => {
    await __resetDbForTests();
  });

  it("lists the six expected palettes", () => {
    expect([...PALETTE_IDS]).toEqual([
      "amber",
      "ocean",
      "emerald",
      "violet",
      "rose",
      "slate",
    ]);
    for (const id of PALETTE_IDS) {
      expect(PALETTE_META[id].label.length).toBeGreaterThan(0);
    }
  });

  it("falls back to amber for unknown values", () => {
    expect(parsePalette(undefined)).toBe(DEFAULT_PALETTE);
    expect(parsePalette("neon")).toBe("amber");
    expect(parsePalette("ocean")).toBe("ocean");
  });

  it("persists the selected palette in Dexie settings", async () => {
    expect(await loadPalette()).toBe("amber");
    await savePalette("slate");
    expect(await loadPalette()).toBe("slate");
    await savePalette("ocean");
    expect(await loadPalette()).toBe("ocean");
  });

  it("mirrors the palette to a local cache for reload", async () => {
    await savePalette("violet");
    if (typeof localStorage === "undefined") return;
    expect(localStorage.getItem("dulcecalle.palette")).toBe("violet");
  });
});
