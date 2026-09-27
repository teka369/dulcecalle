"use client";

import { OfflineLink } from "./OfflineLink";

export function Fab() {
  return (
    <OfflineLink
      href="/ventas/nueva"
      className="fixed bottom-[4.5rem] right-4 z-50 flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg shadow-md"
      ariaLabel="Nueva venta"
    >
      + Nueva venta
    </OfflineLink>
  );
}
