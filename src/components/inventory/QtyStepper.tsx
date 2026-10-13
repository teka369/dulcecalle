"use client";

import { useId } from "react";
import { stepQty } from "./inventory";

/** Big qty stepper (− input +), 56px targets. Input stays editable. */
export function QtyStepper({
  label,
  value,
  onChange,
  max,
  hint,
}: {
  label: string;
  value: string;
  onChange: (raw: string) => void;
  max?: number;
  hint?: string;
}) {
  const id = useId();
  const btn =
    "flex size-14 shrink-0 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-2xl font-semibold text-ink disabled:opacity-40";
  const n = Number.parseInt(value || "0", 10);
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={btn} aria-label="Menos" disabled={!n} onClick={() => onChange(stepQty(value, -1, max))}>
          −
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          placeholder="0"
          aria-describedby={hint ? `${id}-h` : undefined}
          className="h-14 min-w-0 flex-1 rounded-[var(--r-md)] border border-border bg-surface px-3 text-center text-[28px] font-semibold tabular-nums text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--cta)]"
        />
        <button
          type="button"
          className={btn}
          aria-label="Más"
          disabled={max != null && n >= max}
          onClick={() => onChange(stepQty(value, 1, max))}
        >
          +
        </button>
      </div>
      {hint ? (
        <p id={`${id}-h`} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
