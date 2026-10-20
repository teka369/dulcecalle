import { getDb } from "@/storage/db";
import {
  DEFAULT_PALETTE,
  PALETTE_SETTING_KEY,
  effectiveMode,
  parsePalette,
  type PaletteId,
} from "./palettes";
import {
  DEFAULT_MODE,
  MODE_SETTING_KEY,
  parseMode,
  type ColorMode,
} from "./mode";

const PALETTE_CACHE_KEY = "dulcecalle.palette";
const MODE_CACHE_KEY = "dulcecalle.mode";

export function readCachedPalette(): PaletteId {
  if (typeof localStorage === "undefined") return DEFAULT_PALETTE;
  try {
    return parsePalette(localStorage.getItem(PALETTE_CACHE_KEY));
  } catch {
    return DEFAULT_PALETTE;
  }
}

/**
 * Browser theme-color follows --bg, or --hero while a screen with a hero
 * (Inicio) marks <html data-hero="on">.
 */
export function syncThemeColor(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const token = root.dataset.hero === "on" ? "--hero" : "--bg";
  const value = getComputedStyle(root).getPropertyValue(token).trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && value) meta.setAttribute("content", value);
}

export function applyPalette(id: PaletteId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(PALETTE_CACHE_KEY, id);
  } catch {
    /* private mode */
  }
  document.documentElement.dataset.mode = effectiveMode(id, readCachedMode());
  syncThemeColor();
}

export async function loadPalette(): Promise<PaletteId> {
  try {
    const row = await getDb().settings.get(PALETTE_SETTING_KEY);
    // No saved row yet (fresh Dexie, portal-only device): keep the cached
    // choice instead of silently snapping back to amber.
    return row?.value ? parsePalette(row.value) : readCachedPalette();
  } catch {
    return readCachedPalette();
  }
}

export async function savePalette(id: PaletteId): Promise<void> {
  await getDb().settings.put({ key: PALETTE_SETTING_KEY, value: id });
  applyPalette(id);
}

export function readCachedMode(): ColorMode {
  if (typeof localStorage === "undefined") return DEFAULT_MODE;
  try {
    return parseMode(localStorage.getItem(MODE_CACHE_KEY));
  } catch {
    return DEFAULT_MODE;
  }
}

/** Apply color mode without touching data-theme (palette). */
export function applyMode(mode: ColorMode): void {
  if (typeof document === "undefined") return;
  // Saved preference stays as chosen; the attribute reports what renders.
  document.documentElement.dataset.mode = effectiveMode(parsePalette(document.documentElement.dataset.theme), mode);
  try {
    localStorage.setItem(MODE_CACHE_KEY, mode);
  } catch {
    /* private mode */
  }
  syncThemeColor();
}

export async function loadMode(): Promise<ColorMode> {
  try {
    const row = await getDb().settings.get(MODE_SETTING_KEY);
    return row?.value ? parseMode(row.value) : readCachedMode();
  } catch {
    return readCachedMode();
  }
}

export async function saveMode(mode: ColorMode): Promise<void> {
  await getDb().settings.put({ key: MODE_SETTING_KEY, value: mode });
  applyMode(mode);
}
