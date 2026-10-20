export const PALETTE_IDS = [
  "amber",
  "ocean",
  "emerald",
  "violet",
  "rose",
  "slate",
  "cacao",
  "menta",
  "mora",
  "contraste",
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

export const DEFAULT_PALETTE: PaletteId = "amber";

export const PALETTE_META: Record<
  PaletteId,
  {
    label: string;
    swatch: string;
    /** Full theme: ships its own light/dark scheme and ignores data-mode. */
    closed?: boolean;
    /** Closed palettes only: the scheme they actually render (B10: data-mode reports it). */
    scheme?: "light" | "dark";
  }
> = {
  amber: { label: "DulceCalle", swatch: "#FF8C42" },
  ocean: { label: "Ocean", swatch: "#2B6F8A" },
  emerald: { label: "Emerald", swatch: "#2F6F4E" },
  violet: { label: "Violet", swatch: "#6B4C9A" },
  rose: { label: "Rose", swatch: "#9F3D4A" },
  slate: { label: "Slate", swatch: "#334155" },
  cacao: { label: "Cacao", swatch: "#f08a3e", closed: true, scheme: "dark" },
  menta: { label: "Menta", swatch: "#0f6b4f", closed: true, scheme: "light" },
  mora: { label: "Mora", swatch: "#7a2e8c", closed: true, scheme: "light" },
  contraste: { label: "Alto contraste", swatch: "#000000", closed: true, scheme: "light" },
};

export function parsePalette(value: string | null | undefined): PaletteId {
  if (value && (PALETTE_IDS as readonly string[]).includes(value)) {
    return value as PaletteId;
  }
  return DEFAULT_PALETTE;
}

export const PALETTE_SETTING_KEY = "palette";

export function isClosedPalette(id: PaletteId): boolean {
  return PALETTE_META[id].closed === true;
}

/**
 * B10: the mode the page really shows. A closed palette renders its own
 * scheme whatever the user's saved mode is, so <html data-mode> reports
 * that scheme (the saved preference is kept for the open palettes).
 */
export function effectiveMode<M extends string>(id: PaletteId, mode: M): M | "light" | "dark" {
  const meta = PALETTE_META[id];
  return meta.closed ? (meta.scheme ?? "light") : mode;
}
