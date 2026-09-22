"use client";

import Link from "next/link";
import { ThemeSelector } from "@/components/theme/ThemeSelector";

export default function AparienciaPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/mas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Apariencia</h1>
      </header>

      <ThemeSelector />
    </div>
  );
}
