"use client";

import { OfflineLink } from "./OfflineLink";

/** Circular primary action, seated beside the floating nav — not above it. */
export function Fab() {
  return (
    <OfflineLink
      href="/ventas/nueva"
      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-cta text-cta-fg shadow-[var(--shadow-lg)] min-[380px]:size-14"
      ariaLabel="Nueva venta"
    >
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </OfflineLink>
  );
}
