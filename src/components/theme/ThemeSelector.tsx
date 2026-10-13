"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PALETTE,
  PALETTE_IDS,
  PALETTE_META,
  isClosedPalette,
  type PaletteId,
} from "@/theme/palettes";
import { DEFAULT_MODE, type ColorMode } from "@/theme/mode";
import { loadMode, loadPalette, saveMode, savePalette } from "@/theme/storage";

const CLASSIC = PALETTE_IDS.filter((id) => !isClosedPalette(id));
const FULL = PALETTE_IDS.filter((id) => isClosedPalette(id));

/**
 * Preview painted with the theme's real tokens via a scoped data-theme
 * wrapper (no duplicated HEX in JS): hero strip, mini nav pill, CTA dot.
 */
function ThemePreview({ id, mode }: { id: PaletteId; mode: ColorMode }) {
  return (
    <span
      data-theme={id}
      data-mode={isClosedPalette(id) ? undefined : mode}
      className="block overflow-hidden rounded-[var(--r-sm)] border border-border bg-bg"
      aria-hidden
    >
      <span className="block h-5 bg-hero" />
      <span className="flex items-center gap-1.5 bg-bg px-2 py-2">
        <span className="h-3 flex-1 rounded-full bg-nav-pill" />
        <span className="size-3 rounded-full bg-cta" />
      </span>
    </span>
  );
}

/**
 * Shared theme selector (store + customer portal). 6 classic palettes
 * (with light/dark) + 4 full themes that define their own scheme.
 * Persisted on-device, works offline. No backend involved.
 */
export function ThemeSelector() {
  const [current, setCurrent] = useState<PaletteId>(DEFAULT_PALETTE);
  const [mode, setMode] = useState<ColorMode>(DEFAULT_MODE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void Promise.all([loadPalette(), loadMode()]).then(([id, m]) => {
      setCurrent(id);
      setMode(m);
      setReady(true);
    });
  }, []);

  async function onPick(id: PaletteId) {
    setCurrent(id);
    await savePalette(id);
  }

  async function onMode(next: ColorMode) {
    setMode(next);
    await saveMode(next);
  }

  const closed = ready && isClosedPalette(current);
  const dark = ready && mode === "dark";
  const modeDisabled = !ready || closed;

  function grid(ids: readonly PaletteId[]) {
    return (
      <ul className="mt-2 grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
        {ids.map((id) => {
          const meta = PALETTE_META[id];
          const selected = ready && current === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => void onPick(id)}
                aria-pressed={selected}
                className={`flex min-h-11 w-full flex-col gap-1.5 rounded-[var(--r-md)] border-2 p-1.5 text-left text-xs font-semibold ${
                  selected ? "border-cta" : "border-transparent"
                }`}
              >
                <ThemePreview id={id} mode={mode} />
                <span className="flex items-start justify-between gap-1 px-0.5">
                  <span className="min-w-0 break-words leading-tight">{meta.label}</span>
                  {selected ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
        <h2 className="text-sm font-semibold">Tema</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Se guarda en este teléfono. No cambia tus datos.
        </p>
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Clásicos (con modo claro/oscuro)
        </h3>
        {grid(CLASSIC)}
        <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Temas completos
        </h3>
        {grid(FULL)}
      </section>

      <section className="rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Modo oscuro</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {closed
                ? "Este tema ya define claro/oscuro."
                : "Independiente de la paleta. Se guarda en este teléfono."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={dark}
            aria-label="Modo oscuro"
            disabled={modeDisabled}
            onClick={() => void onMode(dark ? "light" : "dark")}
            className={`relative flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:opacity-50 ${
              dark ? "border-cta bg-cta" : "border-border bg-surface-2"
            }`}
          >
            <span
              className={`absolute h-5 w-5 rounded-full bg-surface shadow-[var(--shadow-sm)] transition-transform ${
                dark ? "translate-x-6" : "translate-x-1"
              }`}
              aria-hidden
            />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          {(["light", "dark"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={modeDisabled}
              onClick={() => void onMode(m)}
              aria-pressed={ready && mode === m}
              className={`flex min-h-11 flex-1 items-center justify-center rounded-[var(--r-md)] border px-3 text-sm font-semibold disabled:opacity-50 ${
                ready && mode === m ? "border-cta bg-primary/25" : "border-border bg-surface"
              }`}
            >
              {m === "light" ? "Claro" : "Oscuro"}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
