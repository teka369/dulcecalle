"use client";

import { usePathname } from "next/navigation";
import { OfflineLink } from "./OfflineLink";

/**
 * Circular primary action, seated beside the floating nav — not above it.
 * Same action everywhere (Nueva venta); only the glyph changes: «$» on
 * Inicio, «+» elsewhere.
 */
export function Fab() {
  const pathname = usePathname();
  const home = pathname === "/";
  return (
    <OfflineLink
      href="/ventas/nueva"
      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-cta text-cta-fg shadow-[var(--shadow-lg)] ring-2 ring-[var(--bg)] min-[380px]:size-14"
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
        strokeLinejoin="round"
        aria-hidden
        data-glyph={home ? "dollar" : "plus"}
      >
        {home ? (
          <path d="M12 3v18M16.5 7.5c-.8-1.3-2.5-2-4.5-2-2.5 0-4.5 1.3-4.5 3.3 0 4.4 9 2.4 9 6.9 0 2-2 3.3-4.5 3.3-2 0-3.8-.8-4.6-2.2" />
        ) : (
          <path d="M12 5v14M5 12h14" />
        )}
      </svg>
    </OfflineLink>
  );
}
