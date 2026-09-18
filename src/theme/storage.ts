import { getDb } from "@/storage/db";
import {
  DEFAULT_PALETTE,
  PALETTE_SETTING_KEY,
  parsePalette,
  type PaletteId,
} from "./palettes";

const PALETTE_CACHE_KEY = "dulcecalle.palette";

export function readCachedPalette(): PaletteId {
  if (typeof localStorage === "undefined") return DEFAULT_PALETTE;
  try {
    return parsePalette(localStorage.getItem(PALETTE_CACHE_KEY));
  } catch {
    return DEFAULT_PALETTE;
  }
}

export function applyPalette(id: PaletteId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(PALETTE_CACHE_KEY, id);
  } catch {
    /* private mode */
  }
  const bg = getComputedStyle(document.documentElement)
    .getPropertyValue("--bg")
    .trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
}

export async function loadPalette(): Promise<PaletteId> {
  try {
    const row = await getDb().settings.get(PALETTE_SETTING_KEY);
    return parsePalette(row?.value);
  } catch {
    return readCachedPalette();
  }
}

export async function savePalette(id: PaletteId): Promise<void> {
  await getDb().settings.put({ key: PALETTE_SETTING_KEY, value: id });
  applyPalette(id);
}
