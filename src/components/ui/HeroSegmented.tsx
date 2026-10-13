"use client";

export type SegmentOption<T extends string> = { id: T; label: string; count?: number };

export type HeroSegmentedProps<T extends string> = {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
};

/** Filter/period tabs on hero. Active uses nav-active tokens (≥11:1). */
export function HeroSegmented<T extends string>({ options, value, onChange, label }: HeroSegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="flex gap-1 overflow-x-auto rounded-[var(--r-pill)] bg-[color-mix(in_srgb,var(--on-hero)_12%,transparent)] p-1"
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.id)}
            className={`flex min-h-11 flex-1 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[var(--r-pill)] px-3 text-sm font-semibold ${
              active ? "bg-nav-active-bg text-nav-active-ink" : "text-on-hero"
            }`}
          >
            {o.label}
            {o.count != null ? <span className="tabular-nums opacity-80">({o.count})</span> : null}
          </button>
        );
      })}
    </div>
  );
}
