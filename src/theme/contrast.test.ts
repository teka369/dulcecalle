import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE_IDS, isClosedPalette, type PaletteId } from "./palettes";

/**
 * WCAG 2.x contrast check computed from the real tokens in globals.css.
 * Resolves the custom-property cascade on <html data-theme data-mode> for
 * the selector shapes used there (sorted by specificity, then source order).
 */
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/@import[^;]*;/g, "");

type Block = { selectors: string[]; decls: Record<string, string>; index: number };

const blocks: Block[] = [];
{
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(css))) {
    const decls: Record<string, string> = {};
    for (const d of m[2].split(";")) {
      const i = d.indexOf(":");
      if (i < 0) continue;
      const k = d.slice(0, i).trim();
      if (k.startsWith("--")) decls[k] = d.slice(i + 1).trim();
    }
    blocks.push({ selectors: m[1].split(",").map((s) => s.trim()), decls, index: index++ });
  }
}

function match(sel: string, theme: string, mode: string): number | null {
  // returns specificity (attribute/pseudo count) or null
  let rest = sel;
  let spec = 0;
  if (rest.startsWith(":root")) {
    rest = rest.slice(5);
    spec++;
  }
  const parts = rest.match(/:not\(\[[^\]]+\]\)|\[[^\]]+\]/g) ?? [];
  if (parts.join("") !== rest) return null;
  const attr = (p: string) => {
    const m = /\[data-(theme|mode)(?:="([^"]+)")?\]/.exec(p);
    if (!m) return false;
    const v = m[1] === "theme" ? theme : mode;
    return m[2] == null ? true : m[2] === v;
  };
  for (const p of parts) {
    spec++;
    if (p.startsWith(":not(")) {
      if (attr(p.slice(5, -1))) return null;
    } else if (!attr(p)) return null;
  }
  return spec;
}

function tokens(theme: string, mode: string): Record<string, string> {
  const hits: Array<{ spec: number; index: number; decls: Record<string, string> }> = [];
  for (const b of blocks) {
    const specs = b.selectors.map((s) => match(s, theme, mode)).filter((x): x is number => x != null);
    if (specs.length) hits.push({ spec: Math.max(...specs), index: b.index, decls: b.decls });
  }
  hits.sort((a, b) => a.spec - b.spec || a.index - b.index);
  const out: Record<string, string> = {};
  for (const h of hits) Object.assign(out, h.decls);
  const resolve = (v: string, depth = 0): string =>
    depth > 10 ? v : v.replace(/var\((--[\w-]+)\)/g, (_, n) => resolve(out[n] ?? "", depth + 1));
  for (const k of Object.keys(out)) out[k] = resolve(out[k]);
  return out;
}

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mix(fg: string, bg: string, pct: number): string {
  const p = (h: string) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
  const [a, b] = [p(fg), p(bg)];
  return (
    "#" +
    a
      .map((v, i) => Math.round(v * pct + b[i] * (1 - pct)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Resolves `color-mix(in srgb, #a P%, #b)` (the only form globals.css uses). */
function resolveMix(v: string): string {
  const m = /^color-mix\(in srgb,\s*(#[0-9a-fA-F]{6})\s+(\d+(?:\.\d+)?)%,\s*(#[0-9a-fA-F]{6})\s*\)$/.exec(v.trim());
  return m ? mix(m[1], m[3], Number(m[2]) / 100) : v;
}

export function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const combos: Array<[PaletteId, "light" | "dark"]> = PALETTE_IDS.flatMap((id) =>
  isClosedPalette(id) ? [[id, "light"] as [PaletteId, "light"]] : [[id, "light"], [id, "dark"]] as Array<[PaletteId, "light" | "dark"]>,
);

const TEXT_PAIRS: Array<[string, string]> = [
  ["--cta-fg", "--cta"],
  ["--ink", "--bg"],
  ["--ink", "--surface"],
  ["--ink-muted", "--bg"],
  ["--on-hero", "--hero"],
  ["--on-nav", "--nav-pill"],
  ["--nav-active-ink", "--nav-active-bg"],
  // V2 P1: debt/negative amounts in the sheet.
  ["--danger", "--surface"],
];
const UI_PAIRS: Array<[string, string]> = [
  ["--cta", "--bg"],
  ["--hero-accent", "--hero"],
  ["--nav-active-bg", "--nav-pill"],
];

/**
 * Known, documented exception (TICKET-CONTRAST-AA option A keeps the brand
 * orange): amber light FAB shape vs page bg is 2.21:1. The glyph itself is
 * 6.24:1 and the FAB has a ring + shadow. Option B (--cta #c2410c) would fix
 * it but changes the brand colour — pending Jefecito.
 */
const UI_EXCEPTIONS = new Set(["amber:light:--cta/--bg"]);

describe("WCAG AA contrast from globals.css tokens", () => {
  it("resolves the amber light CTA pair from the ticket", () => {
    const t = tokens("amber", "light");
    expect(t["--cta"]).toBe("#ff8c42");
    expect(t["--cta-fg"]).toBe("#3b241c");
    expect(ratio(t["--cta-fg"], t["--cta"])).toBeGreaterThan(6.2);
    expect(tokens("ocean", "light")["--cta-fg"]).toBe("#ffffff");
  });

  for (const [id, mode] of combos) {
    it(`${id} ${mode}: text ≥ 4.5 and UI ≥ 3`, () => {
      const t = tokens(id, mode);
      for (const [fg, bg] of TEXT_PAIRS) {
        if (!/^#/.test(t[fg] ?? "") || !/^#/.test(t[bg] ?? "")) continue; // color-mix etc.
        expect(ratio(t[fg], t[bg]), `${id}/${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const [fg, bg] of UI_PAIRS) {
        if (UI_EXCEPTIONS.has(`${id}:${mode}:${fg}/${bg}`)) continue;
        if (!/^#/.test(t[fg] ?? "") || !/^#/.test(t[bg] ?? "")) continue;
        expect(ratio(t[fg], t[bg]), `${id}/${mode} ${fg} vs ${bg}`).toBeGreaterThanOrEqual(3);
      }
      // V2 hero pills / back / segmented track: on-hero text on
      // color-mix(on-hero 12%, hero) — must stay ≥ 4.5 (and muted ≥ 4.5).
      const tint = mix(t["--on-hero"], t["--hero"], 0.12);
      const muted = resolveMix(t["--on-hero-muted"]);
      expect(ratio(t["--on-hero"], tint), `${id}/${mode} on-hero on 12% tint`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(muted, tint), `${id}/${mode} on-hero-muted on 12% tint`).toBeGreaterThanOrEqual(4.5);
      expect(t["--cta-fg"], `${id}/${mode} cta-fg`).toMatch(/^#/);
      expect(t["--cta"], `${id}/${mode} cta`).toMatch(/^#/);
    });
  }
});
