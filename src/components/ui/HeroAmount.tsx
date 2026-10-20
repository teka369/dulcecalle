import Link from "next/link";
import type { ReactNode } from "react";

export type HeroAmountProps = {
  label: string;
  value: string;
  caption?: ReactNode;
  href?: string;
  tone?: "default" | "danger" | "ok";
  className?: string;
  /** No real figure yet: skeleton bars instead of value/caption (never a fake $0). */
  loading?: boolean;
};

const BAR = "inline-block rounded bg-[color-mix(in_srgb,var(--on-hero)_15%,transparent)] motion-safe:animate-pulse";

/** Big COP amount on hero. Tone is a dot, never the number colour (AA). */
export function HeroAmount({ label, value, caption, href, tone = "default", className = "", loading = false }: HeroAmountProps) {
  if (loading) {
    return (
      <div className={className} aria-busy="true" data-testid="hero-amount-loading">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-on-hero-muted">{label}</p>
          <span aria-hidden className={`h-4 w-24 ${BAR}`} />
        </div>
        <div className="mt-2">
          <span aria-hidden className={`h-12 w-44 ${BAR}`} />
          <span className="sr-only">Cargando…</span>
        </div>
      </div>
    );
  }
  const number = (
    <p className="break-all text-5xl font-semibold leading-none tracking-tight tabular-nums max-[359px]:text-4xl">
      {value}
    </p>
  );
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-on-hero-muted">
          {tone !== "default" ? (
            <span aria-hidden className={`size-2 rounded-full ${tone === "danger" ? "bg-danger" : "bg-ok"}`} />
          ) : null}
          {label}
        </p>
        {caption != null ? <p className="text-sm text-on-hero-muted">{caption}</p> : null}
      </div>
      {href ? (
        <Link href={href} className="mt-2 block">
          {number}
        </Link>
      ) : (
        <div className="mt-2">{number}</div>
      )}
    </div>
  );
}
