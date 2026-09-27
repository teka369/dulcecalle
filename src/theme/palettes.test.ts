import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "@/storage/db";
import {
  DEFAULT_PALETTE,
  PALETTE_IDS,
  PALETTE_META,
  parsePalette,
} from "./palettes";
import {
  DEFAULT_MODE,
  MODE_IDS,
  parseMode,
} from "./mode";
import { loadMode, loadPalette, saveMode, savePalette } from "./storage";

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

describe("color mode system", () => {
  beforeEach(async () => {
    await __resetDbForTests();
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("dulcecalle.mode");
    }
  });

  it("lists light and dark", () => {
    expect([...MODE_IDS]).toEqual(["light", "dark"]);
  });

  it("falls back to light for unknown values", () => {
    expect(parseMode(undefined)).toBe(DEFAULT_MODE);
    expect(parseMode("neon")).toBe("light");
    expect(parseMode("dark")).toBe("dark");
  });

  it("persists mode in Dexie settings independently of palette", async () => {
    expect(await loadMode()).toBe("light");
    await saveMode("dark");
    expect(await loadMode()).toBe("dark");
    await savePalette("ocean");
    expect(await loadMode()).toBe("dark");
    expect(await loadPalette()).toBe("ocean");
    await saveMode("light");
    expect(await loadMode()).toBe("light");
    expect(await loadPalette()).toBe("ocean");
  });

  it("mirrors mode to a local cache for reload", async () => {
    await saveMode("dark");
    if (typeof localStorage === "undefined") return;
    expect(localStorage.getItem("dulcecalle.mode")).toBe("dark");
  });
});
