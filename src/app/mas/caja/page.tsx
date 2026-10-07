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
  const [showAll, setShowAll] = useState(false);

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
  const alert = statusAlert(summary);
  const visibleMoves = showAll ? summary.moves.slice().reverse() : summary.moves.slice().reverse().slice(0, 4);
  const diff = summary.difference;

  return (
    <div className="flex flex-col gap-5 pb-28">
      <header className="flex items-start gap-3">
        <Link
          href="/mas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-semibold leading-tight">{CASH_COPY.titleCaja}</h1>
          <p className="text-sm text-ink-muted">{formatBusinessDate(summary.localDate)}</p>
        </div>
      </header>

      <StatusBanner alert={alert} open={open} closed={closed} noSession={noSession} />

      {(open || closed) && (
        <section className="rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
          <p className="text-sm text-ink-muted">Efectivo esperado</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight">{formatCop(summary.expected.efectivo)}</p>
          <p className="mt-1 text-sm text-ink-muted">Lo que deberías tener físicamente al cerrar hoy</p>
        </section>
      )}

      {(open || closed) && (
        <section className="rounded-[var(--r-lg)] border border-border bg-surface px-4 py-3">
          <p className="text-sm text-ink-muted">Nequi esperado</p>
          <p className="mt-1 text-2xl font-semibold">{formatCop(summary.expected.nequi)}</p>
          <p className="mt-1 text-xs text-ink-muted">Saldo esperado en Nequi. No cuenta para el efectivo físico.</p>
        </section>
      )}

      {closed && (
        <section className="grid grid-cols-2 gap-3">
          <Card as="article">
            <p className="text-xs text-ink-muted">{CASH_COPY.contado}</p>
            <p className="mt-1 text-xl font-semibold">{summary.counted != null ? formatCop(summary.counted) : "—"}</p>
          </Card>
          <Card as="article">
            <p className="text-xs text-ink-muted">{CASH_COPY.diferencia}</p>
            <p className="mt-1 text-xl font-semibold">{diff != null ? formatCop(Math.abs(diff)) : "—"}</p>
            {diff != null && <p className="text-sm">{differenceLabel(diff)}</p>}
          </Card>
        </section>
      )}

      {open && (
        <OfflineLink
          href="/mas/caja/cerrar"
          className="flex min-h-12 items-center justify-center rounded-[var(--r-md)] bg-cta text-base font-semibold text-cta-fg"
        >
          {CASH_COPY.cerrarCaja}
        </OfflineLink>
      )}

      {(open || closed) && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Actividad de hoy</h2>
          {summary.moves.length === 0 ? (
            <p className="text-sm text-ink-muted">{open ? CASH_COPY.emptyAbierta : CASH_COPY.emptyCerrada}</p>
          ) : (
            visibleMoves.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span aria-hidden="true">{m.direction === "in" ? "🟢" : "🔴"} </span>
                  {kindLabel(m.kind)} · {m.method}
                </span>
                <span className={m.direction === "in" ? "font-semibold text-ok" : "font-semibold text-danger"}>
                  {m.direction === "in" ? "+" : "−"}
                  {formatCop(m.amount)}
                </span>
              </div>
            ))
          )}
          {summary.moves.length > 4 && (
            <button type="button" className="min-h-11 text-left text-sm font-semibold" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Ver menos" : "Ver toda la actividad"}
            </button>
          )}
        </section>
      )}

      {open && (
        <section className="grid grid-cols-1 gap-2">
          <OfflineLink href="/mas/caja/aporte" className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold">
            {CASH_COPY.aporteCapital}
          </OfflineLink>
          <OfflineLink href="/mas/caja/retiro" className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold">
            {CASH_COPY.retiroPersonal}
          </OfflineLink>
          <OfflineLink href="/mas/gastos/nuevo" className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold">
            {CASH_COPY.registrarGasto}
          </OfflineLink>
        </section>
      )}

      <OfflineLink href="/mas/caja/gestionar" className="flex min-h-11 items-center justify-between rounded-[var(--r-md)] border border-border bg-surface px-4 text-sm font-semibold">
        <span>Gestionar cajas</span>
        <span className="text-ink-muted">{summary.pendingCount > 0 ? `${summary.pendingCount} pendientes` : "Sin pendientes"}</span>
      </OfflineLink>

      {noSession && (
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-ink-muted">{CASH_COPY.emptyCerrada}</p>
          <label className="text-sm font-medium" htmlFor="opening">{CASH_COPY.conCuantoAbres}</label>
          <p className="text-sm text-ink-muted">{CASH_COPY.abrirCajaHint}</p>
          <Input id="opening" inputMode="numeric" value={openingRaw} onChange={(e) => setOpeningRaw(e.target.value.replace(/\D/g, ""))} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="button" variant="primary" disabled={busy} onClick={() => void onAbrir()}>
            {CASH_COPY.abrirCaja}
          </Button>
        </Card>
      )}

      {error && open && <p className="text-sm text-danger">{error}</p>}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}

function statusAlert(summary: DayCashSummary): { tone: string; title: string; body: string; href?: string } | null {
  if (summary.conflict) {
    return { tone: "text-danger", title: "Conflicto", body: "Esta caja no coincide entre dispositivos.", href: "/mas/caja/gestionar" };
  }
  if (summary.needsReviewCount > 0) {
    return { tone: "text-danger", title: "Requiere revisión", body: "Hay movimientos que todavía no están asociados a una caja.", href: "/mas/caja/gestionar" };
  }
  if (summary.pendingCount > 0) {
    return {
      tone: "text-warning",
      title: "Cajas pendientes",
      body: summary.pendingCount === 1 ? "Tienes una caja anterior por gestionar." : `Tienes ${summary.pendingCount} cajas anteriores por gestionar.`,
      href: "/mas/caja/gestionar",
    };
  }
  return null;
}

function StatusBanner({
  alert,
  open,
  closed,
  noSession,
}: {
  alert: { tone: string; title: string; body: string; href?: string } | null;
  open: boolean;
  closed: boolean;
  noSession: boolean;
}) {
  if (alert) {
    const inner = (
      <>
        <p className={`text-sm font-semibold ${alert.tone}`}>{alert.title}</p>
        <p className="text-sm text-ink-muted">{alert.body}</p>
      </>
    );
    return alert.href ? (
      <OfflineLink href={alert.href} className="rounded-[var(--r-lg)] border border-border bg-surface p-4">{inner}</OfflineLink>
    ) : (
      <div className="rounded-[var(--r-lg)] border border-border bg-surface p-4">{inner}</div>
    );
  }
  return (
    <div className="rounded-[var(--r-lg)] border border-border bg-surface p-4">
      <p className="text-sm font-semibold text-ok">
        {open ? "Caja abierta" : closed ? "Caja cerrada" : "Sin caja de hoy"}
      </p>
      <p className="text-sm text-ink-muted">
        {noSession ? "Abre la caja para registrar el día." : "Todo está en orden. No hay cajas pendientes."}
      </p>
    </div>
  );
}

function formatBusinessDate(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) return localDate;
  return new Intl.DateTimeFormat("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
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
