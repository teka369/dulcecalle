"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level recovery (App Router). A failed client navigation (e.g. an
 * RSC payload that could not load offline) lands here instead of a blank
 * screen. It never hides data errors: pages keep their own error states.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Available for diagnostics; the UI stays user-facing.
  }, [error]);

  return (
    <div className="flex flex-col gap-3 py-8">
      <h1 className="text-[22px] font-semibold tracking-tight">
        No se pudo abrir esta sección
      </h1>
      <p className="text-base text-ink/80">
        Revisa tu conexión e inténtalo de nuevo. Tus datos guardados en este
        dispositivo están a salvo.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex min-h-11 items-center rounded-xl bg-cta px-4 text-sm font-medium text-white"
        >
          Reintentar
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-xl border border-ink/10 bg-surface px-4 text-sm font-medium"
        >
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
