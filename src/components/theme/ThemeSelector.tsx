"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PALETTE,
  PALETTE_IDS,
  PALETTE_META,
  type PaletteId,
} from "@/theme/palettes";
import { loadPalette, savePalette } from "@/theme/storage";

/**
 * Shared theme selector (store + customer portal). Same 6 palettes,
 * persisted on-device, works offline. No backend involved.
 */
export function ThemeSelector() {
  const [current, setCurrent] = useState<PaletteId>(DEFAULT_PALETTE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadPalette().then((id) => {
      setCurrent(id);
      setReady(true);
    });
  }, []);

  async function onPick(id: PaletteId) {
    setCurrent(id);
    await savePalette(id);
  }

  return (
    <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
      <h2 className="text-sm font-semibold">Paleta de colores</h2>
      <p className="mt-1 text-sm text-ink/60">
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
                className={`flex min-h-11 w-full items-center gap-2 rounded-[14px] border px-3 py-2 text-left text-sm font-semibold ${
                  selected
                    ? "border-cta bg-primary/25"
                    : "border-ink/10 bg-surface"
                }`}
              >
                <span
                  className="h-5 w-5 shrink-0 rounded-full border border-ink/10"
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
  );
}
