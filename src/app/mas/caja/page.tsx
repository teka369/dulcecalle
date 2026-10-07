"use client";

import Link from "next/link";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { Spinner } from "@/components/ui/Spinner";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
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
      {summary.pendingCount > 0 && (
        <Card className="flex flex-col gap-2">
          <p className="text-sm font-semibold">
            {summary.pendingCount === 1
              ? "Tienes una caja pendiente de gestionar"
              : `Tienes ${summary.pendingCount} cajas pendientes`}
          </p>
          <OfflineLink href="/mas/caja/gestionar" className="text-sm font-semibold">Gestionar cajas</OfflineLink>
        </Card>
      )}
      {summary.needsReviewCount > 0 && (
        <p className="text-sm text-ink-muted">Hay movimientos sin caja. Revísalos en Gestionar cajas.</p>
      )}
      <header className="flex items-center gap-2">
        <Link
          href="/mas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold">{CASH_COPY.titleCaja}</h1>
          <p className="text-xs text-ink-muted">{summary.localDate}</p>
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
        <p className="rounded-[var(--r-lg)] border border-border bg-surface p-3 shadow-[var(--shadow-sm)] text-sm text-ink-muted">
          {CASH_COPY.elDiaEstaCerrado}
        </p>
      )}

      {/* Buckets */}
      {(open || closed) && (
        <section className="grid grid-cols-1 gap-3">
          <Card as="article">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {CASH_COPY.esperado} Efectivo
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCop(summary.expected.efectivo)}
            </p>
          </Card>
          <Card as="article">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {CASH_COPY.esperado} Nequi
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCop(summary.expected.nequi)}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Nequi no cuenta en billetes de cierre
            </p>
          </Card>
          <Card as="article">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {CASH_COPY.enCaja}
            </p>
            <p className="mt-1 text-2xl font-semibold">
              {formatCop(summary.expected.total)}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              No es solo billetes. El cierre cuenta Efectivo.
            </p>
            <div className="mt-2 flex gap-4 text-sm text-ink-muted">
              <span>
                {CASH_COPY.entradas}: {formatCop(summary.entradas)}
              </span>
              <span>
                {CASH_COPY.salidas}: {formatCop(summary.salidas)}
              </span>
            </div>
          </Card>
          {(closed || summary.counted != null) && (
            <>
              <Card as="article">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                  {CASH_COPY.contado}
                </p>
                <p className="mt-1 text-2xl font-semibold">
                  {summary.counted != null ? formatCop(summary.counted) : "—"}
                </p>
              </Card>
              {diff != null && (
                <Card as="article">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    {CASH_COPY.diferencia}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">
                    {formatCop(Math.abs(diff))}
                  </p>
                  <p className="mt-1 text-sm font-medium">
                    {differenceLabel(diff)}
                  </p>
                </Card>
              )}
            </>
          )}
        </section>
      )}

      {/* Moves list */}
      {(open || closed) && (
        <section className="flex flex-col gap-2">
          {summary.moves.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {open ? CASH_COPY.emptyAbierta : CASH_COPY.emptyCerrada}
            </p>
          ) : (
            summary.moves
              .slice()
              .reverse()
              .map((m) => (
                <div
                  key={m.id}
                  className="rounded-[var(--r-lg)] border border-border bg-surface px-4 py-3 text-sm shadow-[var(--shadow-sm)]"
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
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{CASH_COPY.emptyCerrada}</p>
          <label className="text-sm font-medium" htmlFor="opening">
            {CASH_COPY.conCuantoAbres}
          </label>
          <p className="text-sm text-ink-muted">{CASH_COPY.abrirCajaHint}</p>
          <Input
            id="opening"
            inputMode="numeric"
            value={openingRaw}
            onChange={(e) => setOpeningRaw(e.target.value.replace(/\D/g, ""))}
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => void onAbrir()}
          >
            {CASH_COPY.abrirCaja}
          </Button>
        </Card>
      )}

      {/* Actions when open — Abrir caja / Cerrar caja only as primary CTAs;
          Retiro/Aporte are in-caja actions; NO Contar caja */}
      {open && (
        <section className="flex flex-col gap-2">
          <OfflineLink
            href="/mas/caja/aporte"
            className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold"
          >
            {CASH_COPY.aporteCapital}
          </OfflineLink>
          <OfflineLink
            href="/mas/caja/retiro"
            className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold"
          >
            {CASH_COPY.retiroPersonal}
          </OfflineLink>
          <OfflineLink
            href="/mas/gastos/nuevo"
            className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold"
          >
            {CASH_COPY.registrarGasto}
          </OfflineLink>
          <OfflineLink
            href="/mas/caja/cerrar"
            className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta text-sm font-semibold text-cta-fg"
          >
            {CASH_COPY.cerrarCaja}
          </OfflineLink>
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
    case "devolucion":
      return "Devolución";
    default:
      return kind;
  }
}

