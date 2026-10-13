"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { HeroSegmented } from "@/components/ui/HeroSegmented";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { dineroCells } from "@/components/cash/cash";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import { STATS_COPY, type StatsPeriod } from "@/domain/stats";
import type { RemoteStats } from "@/data/http/mappers";
import { loadStatsWithOfflineFallback } from "@/data/pwa/offline-snapshots";

const PERIODS: StatsPeriod[] = ["hoy", "semana", "mes"];

export default function EstadisticasPage() {
  const [period, setPeriod] = useState<StatsPeriod>("hoy");
  const [stats, setStats] = useState<RemoteStats | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (p: StatsPeriod) => {
    setLoading(true);
    setError(false);
    try {
      const result = await loadStatsWithOfflineFallback(p);
      setStats(result.data);
      setCapturedAt(result.capturedAt);
      setFromCache(result.source === "cache");
    } catch {
      setError(true);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(period);
  }, [period, refresh]);

  const label = (p: StatsPeriod) =>
    p === "hoy" ? STATS_COPY.periodHoy : p === "semana" ? STATS_COPY.periodSemana : STATS_COPY.periodMes;
  const ok = !loading && !error && stats;

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="tall"
        back={{ href: "/mas", label: "Volver a Más" }}
        title={STATS_COPY.title}
        busy={loading}
        offline={fromCache && capturedAt != null ? { capturedAt } : undefined}
      >
        <div className="mt-4">
          <HeroSegmented<StatsPeriod>
            label="Período"
            value={period}
            onChange={setPeriod}
            options={PERIODS.map((p) => ({ id: p, label: label(p) }))}
          />
        </div>
        {ok ? (
          <div className="mt-5">
            <HeroAmount
              label={STATS_COPY.ventas}
              value={formatCop(stats.ventas)}
              caption={STATS_COPY.nVentas(stats.ventasCount)}
            />
            <p className="mt-2 text-sm text-on-hero-muted">{STATS_COPY.captionVentas}</p>
          </div>
        ) : null}
        {loading ? (
          <p className="mt-5 text-sm text-on-hero-muted" aria-label={STATS_COPY.loadingAria}>
            {STATS_COPY.loading}
          </p>
        ) : null}
      </HeroBlock>

      <Sheet>
        {loading ? <SkeletonRows /> : null}
        {!loading && error ? (
          <StateBlock
            kind="error"
            title={STATS_COPY.errorLoad}
            action={
              <Button type="button" variant="primary" onClick={() => void refresh(period)}>
                {STATS_COPY.reintentar}
              </Button>
            }
          />
        ) : null}
        {ok ? (
          <>
            {stats.emptyPeriod ? <StateBlock kind="empty" title={STATS_COPY.emptyPeriodo} /> : null}

            <section className="flex flex-col gap-2">
              <SectionHead title="Dinero" />
              <div className="grid grid-cols-2 overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface">
                {dineroCells(stats).map((c, i) => (
                  <div
                    key={c.key}
                    className={`flex min-w-0 flex-col gap-1 p-3 ${i % 2 ? "border-l border-border" : ""} ${i > 1 ? "border-t border-border" : ""}`}
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{c.label}</span>
                    <span className="truncate text-lg font-semibold tabular-nums text-ink">{formatCop(c.value)}</span>
                    <span className="text-xs leading-snug text-ink-muted">{c.caption}</span>
                    {c.key === "porCobrar" ? (
                      <Link href="/clientes" className="mt-1 min-h-11 text-xs font-semibold text-ink underline underline-offset-2">
                        {STATS_COPY.verClientes}
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <SectionHead title="Recibido por método" />
              <RowGroup label="Recibido por método">
                <Row title={STATS_COPY.efectivo} trailing={<span className="font-semibold tabular-nums">{formatCop(stats.recibidoEfectivo)}</span>} />
                <Row title={STATS_COPY.nequi} trailing={<span className="font-semibold tabular-nums">{formatCop(stats.recibidoNequi)}</span>} />
              </RowGroup>
            </section>

            <section className="flex flex-col gap-2">
              <SectionHead title="Resultado" />
              <RowGroup label="Resultado">
                <Row
                  title={STATS_COPY.ganancia}
                  meta={STATS_COPY.captionGanancia}
                  trailing={
                    <span className={`text-xl font-semibold tabular-nums ${stats.ganancia < 0 ? "text-danger" : "text-ink"}`}>
                      {formatCop(stats.ganancia)}
                    </span>
                  }
                />
                <Row
                  title={STATS_COPY.devoluciones}
                  meta={STATS_COPY.captionDevoluciones}
                  trailing={<span className="font-semibold tabular-nums">{formatCop(stats.devoluciones)}</span>}
                />
              </RowGroup>
            </section>

            <section className="flex flex-col gap-2">
              <SectionHead title={STATS_COPY.inventario} />
              <RowGroup label={STATS_COPY.inventario}>
                <Row
                  title={STATS_COPY.valorInventario}
                  meta={STATS_COPY.captionInventario}
                  trailing={<span className="font-semibold tabular-nums">{formatCop(stats.valorInventario)}</span>}
                />
                <Row
                  href="/inventario"
                  title={STATS_COPY.stockBajo}
                  trailing={<span className="font-semibold tabular-nums">{stats.stockBajo}</span>}
                />
              </RowGroup>
            </section>

            <Link href="/mas/caja" className="min-h-11 text-center text-sm font-semibold text-ink underline underline-offset-2">
              {STATS_COPY.irACaja}
            </Link>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
