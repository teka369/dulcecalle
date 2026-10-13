import Link from "next/link";
import type { ReactNode } from "react";

export type HeroAmountProps = {
  label: string;
  value: string;
  caption?: ReactNode;
  href?: string;
  tone?: "default" | "danger" | "ok";
  className?: string;
};

/** Big COP amount on hero. Tone is a dot, never the number colour (AA). */
export function HeroAmount({ label, value, caption, href, tone = "default", className = "" }: HeroAmountProps) {
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
