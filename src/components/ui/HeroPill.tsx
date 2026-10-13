import Link from "next/link";
import type { ReactNode } from "react";

export type HeroPillProps = {
  label: ReactNode;
  href?: string;
  onClick?: () => void;
  dot?: "ok" | "warning" | "danger" | null;
  /** Primary: solid on-hero button (bg-on-hero text-hero). */
  primary?: boolean;
};

const DOT = { ok: "bg-ok", warning: "bg-warning", danger: "bg-danger" } as const;

export const HERO_PILL_CLASS =
  "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--r-pill)] border border-[color-mix(in_srgb,var(--on-hero)_20%,transparent)] bg-[color-mix(in_srgb,var(--on-hero)_12%,transparent)] px-3 text-sm font-semibold";
const PRIMARY_CLASS =
  "inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--r-pill)] bg-on-hero px-4 text-sm font-semibold text-hero";

export function HeroPill({ label, href, onClick, dot, primary }: HeroPillProps) {
  const cls = primary ? PRIMARY_CLASS : HERO_PILL_CLASS;
  const body = (
    <>
      {dot ? <span className={`size-2 rounded-full ${DOT[dot]}`} aria-hidden /> : null}
      {label}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}
