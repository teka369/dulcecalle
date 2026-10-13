"use client";

import { useId } from "react";
import { GlyphIcon } from "./icons";

export type HeroSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
};

export function HeroSearch({ value, onChange, placeholder, label }: HeroSearchProps) {
  const id = useId();
  return (
    <div className="relative">
      <label htmlFor={id} className="sr-only">
        {label ?? placeholder}
      </label>
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted" aria-hidden>
        <GlyphIcon name="search" />
      </span>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 min-h-11 w-full rounded-[var(--r-pill)] border-0 bg-surface pl-10 pr-4 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-hero"
      />
    </div>
  );
}
