"use client";

import { useId } from "react";

/** Keep only digits (same rule the forms used inline: value.replace(/\D/g, "")). */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

export type AmountFieldProps = {
  label: string;
  value: string;
  onChange: (digits: string) => void;
  hint?: string;
  error?: string | null;
  placeholder?: string;
};

export function AmountField({ label, value, onChange, hint, error, placeholder = "0" }: AmountFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const described = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2 rounded-[var(--r-md)] border border-border bg-surface px-3 focus-within:ring-2 focus-within:ring-[var(--cta)]">
        <span className="text-2xl font-semibold text-ink-muted" aria-hidden>
          $
        </span>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(digitsOnly(e.target.value))}
          placeholder={placeholder}
          aria-describedby={described}
          aria-invalid={error ? true : undefined}
          className="h-14 min-w-0 flex-1 bg-transparent text-[28px] font-semibold tabular-nums text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errId} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
