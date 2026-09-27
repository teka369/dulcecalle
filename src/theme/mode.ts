export const MODE_IDS = ["light", "dark"] as const;

export type ColorMode = (typeof MODE_IDS)[number];

export const DEFAULT_MODE: ColorMode = "light";

export const MODE_SETTING_KEY = "mode";

export function parseMode(value: string | null | undefined): ColorMode {
  if (value && (MODE_IDS as readonly string[]).includes(value)) {
    return value as ColorMode;
  }
  return DEFAULT_MODE;
}
