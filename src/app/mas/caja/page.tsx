"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import {
  CASH_COPY,
  differenceLabel,
  validateOpeningFloat,
} from "@/domain/cash";
import type { DayCashSummary } from "@/store/cashStore";
import { cashStore } from "@/store/cashStore";

export default function CajaPage() {
  const [summary, setSummary] = useState<DayCashSummary | null>(null);
  const [openingRaw, setOpeningRaw] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const s = await cashStore.refresh();
    setSummary(s);
    setReady(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onAbrir() {
    if (busy) return;
    setError(null);
    const err = validateOpeningFloat(openingRaw);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      await cashStore.openCaja(openingRaw);
      setToast(CASH_COPY.toastCajaAbierta);
      await load();
      setTimeout(() => setToast(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  if (!ready || !summary) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  const open = summary.session != null && !summary.closed;
  const closed = summary.closed;
  const noSession = summary.session == null;

  const diff =
    summary.counted != null
      ? summary.counted - summary.expected.efectivo
      : null;

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/mas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold">{CASH_COPY.titleCaja}</h1>
          <p className="text-xs text-ink/50">{summary.localDate}</p>
        </div>
      </header>

      <p className="text-sm font-medium">
        {closed
          ? CASH_COPY.estadoCerrada
          : open
            ? CASH_COPY.estadoAbierta
            : CASH_COPY.emptyCerrada}
      </p>

      {closed && (
        <p className="rounded-2xl border border-ink/10 bg-white p-3 text-sm text-ink/70">
          {CASH_COPY.elDiaEstaCerrado}
        </p>
      )}

      {/* Buckets */}
      {(open || closed) && (
        <section className="grid grid-cols-1 gap-3">
          <article className="rounded-2xl border border-ink/[0.08] bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
              {CASH_COPY.esperado} Efectivo
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCop(summary.expected.efectivo)}
            </p>
          </article>
          <article className="rounded-2xl border border-ink/[0.08] bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
              {CASH_COPY.esperado} Nequi
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCop(summary.expected.nequi)}
            </p>
            <p className="mt-1 text-xs text-ink/50">
              Nequi no cuenta en billetes de cierre
            </p>
          </article>
          <article className="rounded-2xl border border-ink/[0.08] bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
              {CASH_COPY.enCaja}
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCop(summary.expected.total)}
            </p>
            <div className="mt-2 flex gap-4 text-sm text-ink/60">
              <span>
                {CASH_COPY.entradas}: {formatCop(summary.entradas)}
              </span>
              <span>
                {CASH_COPY.salidas}: {formatCop(summary.salidas)}
              </span>
            </div>
          </article>
          {(closed || summary.counted != null) && (
            <>
              <article className="rounded-2xl border border-ink/[0.08] bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
                  {CASH_COPY.contado}
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {summary.counted != null ? formatCop(summary.counted) : "—"}
                </p>
              </article>
              {diff != null && (
                <article className="rounded-2xl border border-ink/[0.08] bg-white p-4 shadow-sm">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
                    {CASH_COPY.diferencia}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatCop(Math.abs(diff))}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {differenceLabel(diff)}
                  </p>
                </article>
              )}
            </>
          )}
        </section>
      )}

      {/* Moves list */}
      {(open || closed) && (
        <section className="flex flex-col gap-2">
          {summary.moves.length === 0 ? (
            <p className="text-sm text-ink/60">
              {open ? CASH_COPY.emptyAbierta : CASH_COPY.emptyCerrada}
            </p>
          ) : (
            summary.moves
              .slice()
              .reverse()
              .map((m) => (
                <div
                  key={m.id}
                  className="rounded-2xl border border-ink/[0.08] bg-white px-4 py-3 text-sm"
                >
                  <div className="flex justify-between gap-2">
                    <span className="font-medium">
                      {kindLabel(m.kind)} · {m.method}
                    </span>
                    <span
                      className={
                        m.direction === "in" ? "text-ok" : "text-danger"
                      }
                    >
                      {m.direction === "in" ? "+" : "−"}
                      {formatCop(m.amount)}
                    </span>
                  </div>
                </div>
              ))
          )}
        </section>
      )}

      {/* Open form */}
      {noSession && (
        <section className="flex flex-col gap-3 rounded-2xl border border-ink/[0.08] bg-white p-4">
          <p className="text-sm text-ink/60">{CASH_COPY.emptyCerrada}</p>
          <label className="text-sm font-medium" htmlFor="opening">
            {CASH_COPY.conCuantoAbres}
          </label>
          <input
            id="opening"
            inputMode="numeric"
            value={openingRaw}
            onChange={(e) => setOpeningRaw(e.target.value.replace(/\D/g, ""))}
            className="min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void onAbrir()}
            className="min-h-11 rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            {CASH_COPY.abrirCaja}
          </button>
        </section>
      )}

      {/* Actions when open — Abrir caja / Cerrar caja only as primary CTAs;
          Retiro/Aporte are in-caja actions; NO Contar caja */}
      {open && (
        <section className="flex flex-col gap-2">
          <Link
            href="/mas/caja/aporte"
            className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-sm font-semibold"
          >
            {CASH_COPY.aporteCapital}
          </Link>
          <Link
            href="/mas/caja/retiro"
            className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-sm font-semibold"
          >
            {CASH_COPY.retiroPersonal}
          </Link>
          <Link
            href="/mas/gastos/nuevo"
            className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-sm font-semibold"
          >
            {CASH_COPY.registrarGasto}
          </Link>
          <Link
            href="/mas/caja/cerrar"
            className="flex min-h-11 items-center justify-center rounded-[14px] bg-cta text-sm font-semibold text-white"
          >
            {CASH_COPY.cerrarCaja}
          </Link>
        </section>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "expense":
      return "Gasto";
    case "retiro":
      return CASH_COPY.retiroPersonal;
    case "aporte":
      return CASH_COPY.aporteCapital;
    case "sale":
      return "Venta";
    case "debt_collect":
      return "Abono";
    case "compra":
      return "Compra";
    default:
      return kind;
  }
}

