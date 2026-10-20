import Link from "next/link";
import { GlyphIcon, type Glyph } from "./icons";

export type MetricItem = {
  icon: Glyph;
  label: string;
  value: string;
  detail?: string;
  href?: string;
  tone?: "neutral" | "danger" | "accent" | "ok";
  /** No real figure yet: skeleton bar instead of the value (never a fake 0). */
  loading?: boolean;
};

const WELL = {
  neutral: "bg-surface-2 text-ink",
  danger: "bg-danger-soft text-danger",
  accent: "bg-info-soft text-accent",
  ok: "bg-ok-soft text-ok",
} as const;

function Cell({ icon, label, value, detail, href, tone = "neutral", loading = false }: MetricItem) {
  const cls = "flex min-h-[4.5rem] min-w-0 flex-col justify-center gap-1.5 px-2 py-3 min-[380px]:px-3";
  const inner = (
    <>
      <span className={`flex size-8 items-center justify-center rounded-[var(--r-sm)] ${WELL[tone]}`}>
        <GlyphIcon name={icon} />
      </span>
      {loading ? (
        <span className="block h-4 w-10 rounded bg-surface-2 motion-safe:animate-pulse" aria-busy="true" data-testid="metric-loading">
          <span className="sr-only">Cargando…</span>
        </span>
      ) : (
        <span className="block truncate text-[clamp(0.75rem,3.9vw,1rem)] font-semibold leading-tight tracking-tight tabular-nums text-ink" title={value}>{value}</span>
      )}
      <span className="block text-xs leading-tight text-ink-muted">
        {label}
        {detail ? <span className="block">{detail}</span> : null}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** One container, divided cells. Each metric keeps its own label (never merged). */
export function SegmentedMetrics({ items, label }: { items: MetricItem[]; label: string }) {
  const cols = items.length >= 4 ? "grid-cols-2 divide-y" : items.length === 2 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div
      className={`grid ${cols} divide-x divide-border overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface`}
      aria-label={label}
    >
      {items.map((it) => (
        <Cell key={it.label} {...it} />
      ))}
    </div>
  );
}
