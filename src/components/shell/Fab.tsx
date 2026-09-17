"use client";

import Link from "next/link";

export function Fab() {
  return (
    <Link
      href="/ventas/nueva"
      className="fixed bottom-[4.5rem] right-4 z-50 flex min-h-11 min-w-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white shadow-lg shadow-cta/30"
      aria-label="Nueva venta"
    >
      + Nueva venta
    </Link>
  );
}
