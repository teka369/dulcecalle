import { OfflineLink } from "@/components/shell/OfflineLink";
import { GlyphIcon, type Glyph } from "./icons";

export type QuickTile = { href: string; label: string; icon: Glyph };

/** Offline taps are document navigations (OfflineLink), not Next's flaky RSC->MPA fallback. */
export function QuickTiles({ tiles }: { tiles: ReadonlyArray<QuickTile> }) {
  const cols = tiles.length === 2 ? "grid-cols-2" : tiles.length >= 4 ? "grid-cols-4" : "grid-cols-3";
  return (
    <div className={`mt-3 grid ${cols} gap-2`}>
      {tiles.map((item) => (
        <OfflineLink
          key={item.href}
          href={item.href}
          className="flex min-h-[5.75rem] flex-col items-center justify-center gap-2 rounded-[var(--r-lg)] border border-border bg-surface px-2 py-3 text-center"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-primary/25 text-ink">
            <GlyphIcon name={item.icon} />
          </span>
          <span className="text-xs font-semibold leading-tight text-ink">{item.label}</span>
        </OfflineLink>
      ))}
    </div>
  );
}
