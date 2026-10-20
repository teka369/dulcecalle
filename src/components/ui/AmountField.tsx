"use client";

import { useEffect, useId, useState } from "react";
import { parseAmountInput } from "@/domain/money/limits";

/** Keep only digits (same rule the forms used inline: value.replace(/\D/g, "")). */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "");
}

/**
 * Mounted AmountFields whose text is currently rejected (decimals, above the
 * ceiling). Forms call `amountInputInvalid()` before submitting so a rejected
 * amount never sends anything — neither "" nor a stale valid value.
 */
const rejectedFields = new Set<string>();

export function amountInputInvalid(): boolean {
  return rejectedFields.size > 0;
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
  // Format problems (decimals, above the ceiling) are caught here, before the
  // value reaches the form: the field keeps the last valid amount.
  const [inputError, setInputError] = useState<string | null>(null);
  // While the text is invalid we show exactly what was typed (so «1500,50» typed
  // key by key never silently becomes 150050) and the form gets no amount.
  const [rejectedRaw, setRejectedRaw] = useState<string | null>(null);
  useEffect(() => {
    if (rejectedRaw === null) {
      rejectedFields.delete(id);
      return;
    }
    rejectedFields.add(id);
    return () => {
      rejectedFields.delete(id);
    };
  }, [rejectedRaw, id]);
  const shownError = inputError ?? error ?? null;
  const described = [hint ? hintId : null, shownError ? errId : null].filter(Boolean).join(" ") || undefined;
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
          value={rejectedRaw ?? value}
          onChange={(e) => {
            const parsed = parseAmountInput(e.target.value);
            if ("error" in parsed) {
              setInputError(parsed.error);
              setRejectedRaw(e.target.value);
              onChange("");
              return;
            }
            setInputError(null);
            setRejectedRaw(null);
            onChange(parsed.digits);
          }}
          placeholder={placeholder}
          aria-describedby={described}
          aria-invalid={shownError ? true : undefined}
          className="h-14 min-w-0 flex-1 bg-transparent text-[28px] font-semibold tabular-nums text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      {hint ? (
        <p id={hintId} className="mt-1.5 text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {shownError ? (
        <p id={errId} className="mt-1.5 text-sm text-danger">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
