import type { ReactNode } from "react";

export type StateBlockProps = {
  kind: "empty" | "error" | "offline-miss";
  title: string;
  body?: string;
  action?: ReactNode;
  /** Render on hero (error inside hero) instead of a sheet group. */
  onHero?: boolean;
};

export function StateBlock({ kind, title, body, action, onHero = false }: StateBlockProps) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={
        onHero
          ? "flex flex-col gap-2 py-4"
          : "flex flex-col gap-2 rounded-[var(--r-lg)] border border-border bg-surface px-3 py-4"
      }
    >
      <p className={`text-base font-semibold ${onHero ? "" : "text-ink"}`}>{title}</p>
      {body ? <p className={`text-sm ${onHero ? "text-on-hero-muted" : "text-ink-muted"}`}>{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
