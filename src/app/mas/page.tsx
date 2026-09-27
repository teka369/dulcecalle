"use client";

import Link from "next/link";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { Card } from "@/components/ui/Card";
import { CASH_COPY } from "@/domain/cash";
import { STATS_COPY } from "@/domain/stats";

const rowClass =
  "flex min-h-11 items-center justify-between text-base font-semibold";

export default function MasPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold">Más</h1>

      <nav className="flex flex-col gap-2">
        <Card>
          <Link href="/mas/estadisticas" className={rowClass}>
            <span>{STATS_COPY.masItem}</span>
            <span className="text-ink/40">→</span>
          </Link>
        </Card>
        <Card>
          <OfflineLink href="/mas/gastos" className={rowClass}>
            <span>{CASH_COPY.masGastos}</span>
            <span className="text-ink/40">→</span>
          </OfflineLink>
        </Card>
        <Card>
          <OfflineLink href="/mas/caja" className={rowClass}>
            <span>{CASH_COPY.masCaja}</span>
            <span className="text-ink/40">→</span>
          </OfflineLink>
        </Card>
        <Card>
          <Link href="/mas/apariencia" className={rowClass}>
            <span>Apariencia</span>
            <span className="text-ink/40">→</span>
          </Link>
        </Card>
        <Card>
          <Link href="/mas/datos" className={rowClass}>
            <span>Datos</span>
            <span className="text-ink/40">→</span>
          </Link>
        </Card>
        <Card>
          <Link href="/login" className={rowClass}>
            <span>Cuenta</span>
            <span className="text-ink/40">→</span>
          </Link>
        </Card>
      </nav>
    </div>
  );
}
