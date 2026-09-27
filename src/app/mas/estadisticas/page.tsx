"use client";

import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";
import { Empty } from "@/components/ui/Empty";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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

  return (
    <div className="flex flex-col gap-4 pb-8">
      <header className="flex items-center gap-2">
        <Link
          href="/mas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold">{STATS_COPY.title}</h1>
          <p className="text-sm text-ink-muted">{STATS_COPY.subtitle}</p>
        </div>
      </header>

      <div
        className="flex gap-2 rounded-[var(--r-lg)] border border-border bg-surface p-1"
        role="tablist"
        aria-label="Período"
      >
        {PERIODS.map((p) => {
          const label =
            p === "hoy"
              ? STATS_COPY.periodHoy
              : p === "semana"
                ? STATS_COPY.periodSemana
                : STATS_COPY.periodMes;
          const active = period === p;
          return (
            <Button
              key={p}
              type="button"
              variant="ghost"
              role="tab"
              aria-selected={active}
              onClick={() => setPeriod(p)}
              className={`flex-1 ${
                active ? "bg-primary text-ink hover:text-ink" : "text-ink-muted"
              }`}
            >
              {label}
            </Button>
          );
        })}
      </div>

      {loading && (
        <div
          className="flex flex-col items-center gap-3 py-6"
          aria-busy="true"
          aria-label={STATS_COPY.loadingAria}
        >
          <Spinner />
          <p className="text-sm text-ink-muted">{STATS_COPY.loading}</p>
        </div>
      )}

      {!loading && error && (
        <Card>
          <p className="font-medium">{STATS_COPY.errorLoad}</p>
          <Button
            type="button"
            variant="primary"
            onClick={() => void refresh(period)}
            className="mt-3"
          >
            {STATS_COPY.reintentar}
          </Button>
        </Card>
      )}

      {!loading && !error && stats && (
        <>
          {fromCache && capturedAt != null && (
            <p className="text-xs text-ink-muted">
              Sin conexión · última actualización: {new Date(capturedAt).toLocaleString()}.
            </p>
          )}
          {stats.emptyPeriod && (
            <Empty title={STATS_COPY.emptyPeriodo} />
          )}

          <MetricCard
            title={STATS_COPY.ventas}
            caption={STATS_COPY.captionVentas}
            value={formatCop(stats.ventas)}
            sub={STATS_COPY.nVentas(stats.ventasCount)}
          />

          <MetricCard
            title={STATS_COPY.devoluciones}
            caption={STATS_COPY.captionDevoluciones}
            value={formatCop(stats.devoluciones)}
            tone="danger"
          />

          <MetricCard
            title={STATS_COPY.recibido}
            caption={STATS_COPY.captionRecibido}
            value={formatCop(stats.recibido)}
            sub={`${STATS_COPY.efectivo} ${formatCop(stats.recibidoEfectivo)} · ${STATS_COPY.nequi} ${formatCop(stats.recibidoNequi)}`}
          />

          <MetricCard
            title={STATS_COPY.porCobrar}
            caption={STATS_COPY.captionPorCobrar}
            value={formatCop(stats.porCobrar)}
            tone="accent"
            actionHref="/clientes"
            actionLabel={STATS_COPY.verClientes}
          />

          <MetricCard
            title={STATS_COPY.gaste}
            caption={STATS_COPY.captionGaste}
            value={formatCop(stats.gaste)}
            tone="danger"
          />

          <MetricCard
            title={STATS_COPY.inverti}
            caption={STATS_COPY.captionInverti}
            value={formatCop(stats.inverti)}
          />

          <Card as="article">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {STATS_COPY.inventario}
            </p>
            <p className="mt-1 text-xs text-ink-muted">{STATS_COPY.captionInventario}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Row
                label={STATS_COPY.valorInventario}
                value={formatCop(stats.valorInventario)}
              />
              <Row label={STATS_COPY.stockBajo} value={String(stats.stockBajo)} />
            </div>
            <Link
              href="/inventario"
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
            >
              {STATS_COPY.verInventario}
            </Link>
          </Card>

          <MetricCard
            title={STATS_COPY.ganancia}
            caption={STATS_COPY.captionGanancia}
            value={formatCop(stats.ganancia)}
            tone={stats.ganancia < 0 ? "danger" : "ok"}
          />

          <Link
            href="/mas/caja"
            className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold shadow-sm"
          >
            {STATS_COPY.irACaja}
          </Link>
        </>
      )}
    </div>
  );
}

function MetricCard({
  title,
  caption,
  value,
  sub,
  tone = "default",
  actionHref,
  actionLabel,
}: {
  title: string;
  caption: string;
  value: string;
  sub?: string;
  tone?: "default" | "accent" | "danger" | "ok";
  actionHref?: string;
  actionLabel?: string;
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent"
      : tone === "danger"
        ? "text-danger"
        : tone === "ok"
          ? "text-ok"
          : "text-ink";

  return (
    <Card as="article">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {title}
      </p>
      <p className="mt-1 text-xs text-ink-muted">{caption}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-sm text-ink-muted">{sub}</p>}
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
        >
          {actionLabel}
        </Link>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
