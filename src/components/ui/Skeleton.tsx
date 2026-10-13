import { HeroBlock } from "./HeroBlock";

const HERO_BAR = "rounded bg-[color-mix(in_srgb,var(--on-hero)_15%,transparent)] motion-safe:animate-pulse";

export function SkeletonHero() {
  return (
    <HeroBlock busy>
      <div className={`h-7 w-40 ${HERO_BAR}`} />
      <div className={`mt-2 h-4 w-28 ${HERO_BAR}`} />
      <div className={`mt-7 h-4 w-16 ${HERO_BAR}`} />
      <div className={`mt-3 h-12 w-44 ${HERO_BAR}`} />
    </HeroBlock>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 border-b border-border px-3 last:border-b-0">
          <div className="h-4 flex-1 rounded bg-surface-2 motion-safe:animate-pulse" />
          <div className="h-4 w-16 rounded bg-surface-2 motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
