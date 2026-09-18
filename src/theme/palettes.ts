export const PALETTE_IDS = [
  "amber",
  "ocean",
  "emerald",
  "violet",
  "rose",
  "slate",
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

export const DEFAULT_PALETTE: PaletteId = "amber";

export const PALETTE_META: Record<
  PaletteId,
  { label: string; swatch: string }
> = {
  amber: { label: "Amber", swatch: "#FF8C42" },
  ocean: { label: "Ocean", swatch: "#2B6F8A" },
  emerald: { label: "Emerald", swatch: "#2F6F4E" },
  violet: { label: "Violet", swatch: "#6B4C9A" },
  rose: { label: "Rose", swatch: "#9F3D4A" },
  slate: { label: "Slate", swatch: "#334155" },
};

export function parsePalette(value: string | null | undefined): PaletteId {
  if (value && (PALETTE_IDS as readonly string[]).includes(value)) {
    return value as PaletteId;
  }
  return DEFAULT_PALETTE;
}

export const PALETTE_SETTING_KEY = "palette";
