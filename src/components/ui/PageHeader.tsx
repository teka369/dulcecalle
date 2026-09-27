import type { ReactNode } from "react";

export type PageHeaderProps = {
  /** Hub / list title — 22px semibold per U0. */
  title: string;
  /** One-line muted status / count / helper. */
  subtitle?: string;
  /** Optional search, chips, or secondary controls under the title block. */
  children?: ReactNode;
  className?: string;
};

/**
 * Shared page header for list/hub roots (U0).
 * Back-chevron belongs on stack screens, not tab roots — do not put it here.
 */
export function PageHeader({
  title,
  subtitle,
  children,
  className = "",
}: PageHeaderProps) {
  return (
    <header
      className={["flex flex-col gap-3", className].filter(Boolean).join(" ")}
    >
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm leading-snug text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex min-w-0 flex-col gap-2">{children}</div>
      ) : null}
    </header>
  );
}
