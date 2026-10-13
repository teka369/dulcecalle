import type { ReactNode } from "react";

/** One bordered surface group; rows separated by dividers (no shadows). */
export function RowGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface">
      <ul className="divide-y divide-border" aria-label={label}>
        {children}
      </ul>
    </div>
  );
}

/** Single muted line inside a group (empty state for a list). */
export function RowGroupNote({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface">
      <p className="px-3 py-2.5 text-sm text-ink-muted">{children}</p>
    </div>
  );
}
