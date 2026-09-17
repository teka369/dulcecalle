"use client";

import Link from "next/link";
import { CASH_COPY } from "@/domain/cash";

export default function MasPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold">Más</h1>

      <nav className="flex flex-col gap-2">
        <Link
          href="/mas/gastos"
          className="flex min-h-11 items-center justify-between rounded-2xl border border-ink/[0.08] bg-white px-4 text-base font-semibold shadow-sm"
        >
          <span>{CASH_COPY.masGastos}</span>
          <span className="text-ink/40">→</span>
        </Link>
        <Link
          href="/mas/caja"
          className="flex min-h-11 items-center justify-between rounded-2xl border border-ink/[0.08] bg-white px-4 text-base font-semibold shadow-sm"
        >
          <span>{CASH_COPY.masCaja}</span>
          <span className="text-ink/40">→</span>
        </Link>
      </nav>
    </div>
  );
}
