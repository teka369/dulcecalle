"use client";

import { useRef, type KeyboardEvent } from "react";
import { GlyphIcon } from "./icons";

export type Choice<T extends string> = { id: T; label: string; disabled?: boolean };

export type ChoiceSegmentedProps<T extends string> = {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (id: T) => void;
  label: string;
};

/** Big radio group (56px). Selected = cta/cta-fg + check (not colour only). */
export function ChoiceSegmented<T extends string>({ options, value, onChange, label }: ChoiceSegmentedProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKey(e: KeyboardEvent, i: number) {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    let n = i;
    for (let k = 0; k < options.length; k++) {
      n = (n + d + options.length) % options.length;
      if (!options[n].disabled) break;
    }
    if (options[n].disabled) return;
    onChange(options[n].id);
    refs.current[n]?.focus();
  }
  const cols = options.length === 2 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div role="radiogroup" aria-label={label} className={`grid ${cols} gap-2`}>
      {options.map((o, i) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={o.disabled || undefined}
            disabled={o.disabled}
            tabIndex={on ? 0 : -1}
            onClick={() => {
              if (!o.disabled) onChange(o.id);
            }}
            onKeyDown={(e) => onKey(e, i)}
            className={`flex min-h-14 items-center justify-center gap-1.5 rounded-[var(--r-md)] border px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cta)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
              on ? "border-cta bg-cta text-cta-fg" : o.disabled ? "cursor-not-allowed border-dashed border-border bg-surface-2 text-ink-muted" : "border-border bg-surface text-ink"
            }`}
          >
            {on ? <GlyphIcon name="check" /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
