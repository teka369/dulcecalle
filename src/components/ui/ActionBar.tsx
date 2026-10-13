"use client";

import { useEffect, type ReactNode } from "react";

export type ActionBarProps = {
  primary: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean };
  summary?: ReactNode;
  /** True when nav/FAB are visible on this route: bar stacks above the nav. */
  aboveNav?: boolean;
};

/**
 * Fixed bottom action bar inside the max-w-lg column. Respects safe-area.
 * Height is the --actionbar-h CSS variable (globals.css); pages reserve it
 * with ACTION_BAR_SPACE so content (and SyncPill over content) is not hidden.
 */
export const ACTION_BAR_SPACE = "pb-[calc(var(--actionbar-h)+1.5rem)]";
/** Toast/feedback offset that clears the bar. */
/** Toast/feedback offset: clears the bar AND the SyncPill stacked above it. */
export const ABOVE_ACTION_BAR = "bottom-[calc(var(--actionbar-h)+var(--syncpill-h)+1.25rem)]";

/** Marks <html data-actionbar> so SyncPill (shell) lifts above the bar. */
export function useActionBarMark(aboveNav: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.actionbar = aboveNav ? "nav" : "on";
    return () => {
      delete root.dataset.actionbar;
    };
  }, [aboveNav]);
}

export function ActionBar({ primary, summary, aboveNav = false }: ActionBarProps) {
  useActionBarMark(aboveNav);
  const bottom = aboveNav
    ? "bottom-[calc(4.75rem+max(0.75rem,env(safe-area-inset-bottom)))]"
    : "bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]";
  return (
    <div className={`fixed inset-x-0 z-40 ${bottom}`}>
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 border-t border-border bg-surface/95 px-4 pt-3 backdrop-blur">
        {summary != null ? <div className="min-w-0 text-sm font-medium tabular-nums text-ink">{summary}</div> : null}
        <button
          type="button"
          onClick={primary.onClick}
          disabled={primary.disabled || primary.busy}
          aria-busy={primary.busy || undefined}
          className={`inline-flex min-h-[3.25rem] items-center justify-center rounded-[var(--r-md)] bg-cta px-6 text-base font-semibold text-cta-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cta)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:border disabled:border-border disabled:bg-surface-2 disabled:text-ink-muted ${
            summary != null ? "shrink-0" : "w-full"
          }`}
        >
          {primary.label}
        </button>
      </div>
    </div>
  );
}
