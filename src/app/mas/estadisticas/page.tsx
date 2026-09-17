"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import { STATS_COPY, type StatsPeriod } from "@/domain/stats";
import {
  loadStats,
  type StatsSnapshot,
} from "@/repositories/statsRepository";

const PERIODS: StatsPeriod[] = ["hoy", "semana", "mes"];

export default function EstadisticasPage() {
  const [period, setPeriod] = useState<StatsPeriod>("hoy");
  const [stats, setStats] = useState<StatsSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (p: StatsPeriod) => {
    setLoading(true);
    setError(false);
    try {
      const snap = await loadStats(p);
      setStats(snap);
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
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold">{STATS_COPY.title}</h1>
          <p className="text-sm text-ink/60">{STATS_COPY.subtitle}</p>
        </div>
      </header>

      <div
        className="flex gap-2 rounded-2xl border border-ink/[0.08] bg-white p-1"
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
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setPeriod(p)}
              className={`min-h-11 flex-1 rounded-[14px] text-sm font-semibold ${
                active ? "bg-primary text-ink" : "text-ink/60"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading && (
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-label={STATS_COPY.loadingAria}
        >
          <p className="text-sm text-ink/60">{STATS_COPY.loading}</p>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-ink/[0.08] bg-ink/[0.04]"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-ink/10 bg-white p-4">
          <p className="font-medium">{STATS_COPY.errorLoad}</p>
          <button
            type="button"
            onClick={() => void refresh(period)}
            className="mt-3 min-h-11 rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
          >
            {STATS_COPY.reintentar}
          </button>
        </div>
      )}

      {!loading && !error && stats && (
        <>
          {stats.emptyPeriod && (
            <div className="rounded-2xl border border-ink/10 bg-white p-4">
              <p className="text-sm text-ink/70">{STATS_COPY.emptyPeriodo}</p>
            </div>
          )}

          <MetricCard
            title={STATS_COPY.ventas}
            caption={STATS_COPY.captionVentas}
            value={formatCop(stats.ventas)}
            sub={STATS_COPY.nVentas(stats.ventasCount)}
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

          <article className="rounded-2xl border border-ink/[0.08] bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
              {STATS_COPY.inventario}
            </p>
            <p className="mt-1 text-xs text-ink/55">{STATS_COPY.captionInventario}</p>
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
          </article>

          <MetricCard
            title={STATS_COPY.ganancia}
            caption={STATS_COPY.captionGanancia}
            value={formatCop(stats.ganancia)}
            tone={stats.ganancia < 0 ? "danger" : "ok"}
          />

          <Link
            href="/mas/caja"
            className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-sm font-semibold shadow-sm"
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
    <article className="rounded-2xl border border-ink/[0.08] bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
        {title}
      </p>
      <p className="mt-1 text-xs text-ink/55">{caption}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
      {sub && <p className="mt-1 text-sm text-ink/55">{sub}</p>}
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-accent"
        >
          {actionLabel}
        </Link>
      )}
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-ink/70">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
