"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PALETTE,
  PALETTE_IDS,
  PALETTE_META,
  type PaletteId,
} from "@/theme/palettes";
import { DEFAULT_MODE, type ColorMode } from "@/theme/mode";
import { loadMode, loadPalette, saveMode, savePalette } from "@/theme/storage";

/**
 * Shared theme selector (store + customer portal). Same 6 palettes,
 * persisted on-device, works offline. Includes independent dark mode toggle.
 * No backend involved.
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

  const dark = ready && mode === "dark";

  return (
    <div className="flex flex-col gap-4">
      <section
        className="rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
      >
        <h2 className="text-sm font-semibold">Paleta de colores</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Se guarda en este teléfono. No cambia tus datos.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2">
          {PALETTE_IDS.map((id) => {
            const meta = PALETTE_META[id];
            const selected = ready && current === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => void onPick(id)}
                  aria-pressed={selected}
                  className={`flex min-h-11 w-full items-center gap-2 rounded-[var(--r-md)] border px-3 py-2 text-left text-sm font-semibold ${
                    selected
                      ? "border-cta bg-primary/25"
                      : "border-border bg-surface"
                  }`}
                >
                  <span
                    className="h-5 w-5 shrink-0 rounded-full border border-border"
                    style={{ background: meta.swatch }}
                    aria-hidden
                  />
                  {meta.label}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        className="rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Modo oscuro</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Independiente de la paleta. Se guarda en este teléfono.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={dark}
            aria-label="Modo oscuro"
            onClick={() => void onMode(dark ? "light" : "dark")}
            className={`relative flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
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
          <button
            type="button"
            onClick={() => void onMode("light")}
            aria-pressed={ready && mode === "light"}
            className={`flex min-h-11 flex-1 items-center justify-center rounded-[var(--r-md)] border px-3 text-sm font-semibold ${
              ready && mode === "light"
                ? "border-cta bg-primary/25"
                : "border-border bg-surface"
            }`}
          >
            Claro
          </button>
          <button
            type="button"
            onClick={() => void onMode("dark")}
            aria-pressed={ready && mode === "dark"}
            className={`flex min-h-11 flex-1 items-center justify-center rounded-[var(--r-md)] border px-3 text-sm font-semibold ${
              ready && mode === "dark"
                ? "border-cta bg-primary/25"
                : "border-border bg-surface"
            }`}
          >
            Oscuro
          </button>
        </div>
      </section>
    </div>
  );
}
