"use client";

import { CASH_COPY } from "@/domain/cash";
import { STATS_COPY } from "@/domain/stats";
import { useCash } from "@/store/cashStore";
import { getCachedBusinessLabel } from "@/data/pwa/dashboard";
import { useEffect, useState } from "react";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { Badge } from "@/components/ui/Badge";
import { GlyphIcon, type Glyph } from "@/components/ui/icons";

function Lead({ icon }: { icon: Glyph }) {
  return (
    <span className="flex size-9 items-center justify-center rounded-[var(--r-sm)] bg-surface-2 text-ink">
      <GlyphIcon name={icon} />
    </span>
  );
}

/** Más hub. Caja pill/badge only from already-loaded cashStore data (no new fetch). */
export default function MasPage() {
  const { summary } = useCash();
  // Read after mount (session lives in localStorage); no fetch — null until Inicio has loaded it.
  const [businessLabel, setBusinessLabel] = useState<string | null>(null);
  useEffect(() => setBusinessLabel(getCachedBusinessLabel()), []);
  const pending = summary?.pendingCount ?? 0;
  const pill = !summary
    ? null
    : pending > 0
      ? { href: "/mas/caja/gestionar", label: "Caja pendiente", dot: "warning" as const }
      : summary.session && !summary.closed
        ? { href: "/mas/caja", label: CASH_COPY.estadoAbierta, dot: "ok" as const }
        : summary.closed
          ? { href: "/mas/caja", label: CASH_COPY.estadoCerrada, dot: null }
          : { href: "/mas/caja", label: CASH_COPY.abrirCaja, dot: null };

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="tall"
        title="Más"
        subtitle={businessLabel ? `${businessLabel} · Caja, gastos y ajustes de la tienda` : "Caja, gastos y ajustes de la tienda"}
        action={pill ? <HeroPill label={pill.label} href={pill.href} dot={pill.dot} /> : undefined}
      />
      <Sheet>
        <section className="flex flex-col gap-2" aria-label="Negocio">
          <SectionHead title="Negocio" />
          <RowGroup label="Negocio">
            <Row
              href="/mas/caja"
              leading={<Lead icon="cash" />}
              title={CASH_COPY.masCaja}
              trailing={pending > 0 ? <Badge tone="warning">{pending === 1 ? "1 pendiente" : `${pending} pendientes`}</Badge> : undefined}
            />
            <Row href="/mas/estadisticas" leading={<Lead icon="clock" />} title={STATS_COPY.masItem} />
            <Row href="/mas/gastos" leading={<Lead icon="bag" />} title={CASH_COPY.masGastos} />
          </RowGroup>
        </section>
        <section className="flex flex-col gap-2" aria-label="Ajustes">
          <SectionHead title="Ajustes" />
          <RowGroup label="Ajustes">
            <Row href="/mas/apariencia" leading={<Lead icon="check" />} title="Apariencia" />
            <Row href="/mas/datos" leading={<Lead icon="package" />} title="Datos" />
            <Row href="/login" leading={<Lead icon="users" />} title="Cuenta" />
          </RowGroup>
        </section>
      </Sheet>
    </div>
  );
}
