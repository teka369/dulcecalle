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
  }
> = {
  amber: { label: "DulceCalle", swatch: "#FF8C42" },
  ocean: { label: "Ocean", swatch: "#2B6F8A" },
  emerald: { label: "Emerald", swatch: "#2F6F4E" },
  violet: { label: "Violet", swatch: "#6B4C9A" },
  rose: { label: "Rose", swatch: "#9F3D4A" },
  slate: { label: "Slate", swatch: "#334155" },
  cacao: { label: "Cacao", swatch: "#f08a3e", closed: true },
  menta: { label: "Menta", swatch: "#0f6b4f", closed: true },
  mora: { label: "Mora", swatch: "#7a2e8c", closed: true },
  contraste: { label: "Alto contraste", swatch: "#000000", closed: true },
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
