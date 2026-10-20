"use client";

import { errorText } from "@/domain/ux/user-message";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { SegmentedMetrics, type MetricItem } from "@/components/ui/SegmentedMetrics";
import { QuickTiles } from "@/components/ui/QuickTiles";
import { useAfterSync } from "@/components/shell/use-after-sync";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { AmountField, amountInputInvalid } from "@/components/ui/AmountField";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";
import { usePrefill } from "@/components/ui/use-prefill";
import { useRejectedCorrection } from "@/components/ui/use-rejected-correction";
import { CASH_OFFLINE_NOCACHE, cashOfflineView, cashPageGate, kindLabel, moveSign, shortDay } from "@/components/cash/cash";
import { useSync } from "@/store/syncStore";
import { usePrep } from "@/store/prepStore";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const { online } = useSync();
  const { lastReadyAt } = usePrep();
  usePrefill("monto", setOpeningRaw); // «Corregir» on a rejected caja open
  const rejected = useRejectedCorrection();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await cashStore.refresh();
      setSummary(s);
    } catch (e) {
      setLoadError(errorText(e, "No se pudo cargar."));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useAfterSync(load);

  async function onAbrir() {
    if (amountInputInvalid()) return; // a rejected amount is on screen: never send
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
      rejected.afterSave(() => undefined, 0);
    } catch (e) {
      setError(errorText(e, "Error"));
    } finally {
      setBusy(false);
    }
  }

  // Offline, «Reintentar» cannot succeed: show it only when online again (D9).
  const retryButton = !online ? undefined : (
    <button
      type="button"
      onClick={() => void load()}
      className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
    >
      Reintentar
    </button>
  );

  const hasLocalData = summary != null && (summary.session != null || summary.moves.length > 0 || summary.pendingCount > 0);
  const offlineView = cashOfflineView({ online, preparedAt: lastReadyAt, hasLocalData });

  const gate = cashPageGate({ source: cashStore.getSnapshot().source, loadError, offlineView, hasLocalData });
  if (ready && gate !== "ok") {
    return (
      <div className="flex flex-col pb-6">
        <HeroBlock
          size="medium"
          back={{ href: "/mas", label: "Volver a Más" }}
          title={CASH_COPY.titleCaja}
          offline={null}
        />
        <Sheet>
          {gate === "offline" ? (
            <StateBlock
              kind="offline-miss"
              title={CASH_OFFLINE_NOCACHE.title}
              body={CASH_OFFLINE_NOCACHE.body}
              action={
                <OfflineLink
                  href="/"
                  className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
                >
                  {CASH_OFFLINE_NOCACHE.action}
                </OfflineLink>
              }
            />
          ) : (
            <StateBlock kind="error" title="No se pudo cargar." body={loadError ?? undefined} action={retryButton} />
          )}
        </Sheet>
      </div>
    );
  }

  // The global sync pill already says «Sin conexión»; the band says what the data is (D9).
  const band =
    offlineView === "offline-cache"
      ? { text: lastReadyAt != null ? `Datos de este teléfono · actualizado ${new Date(lastReadyAt).toLocaleString("es-CO")}` : "Datos de este teléfono" }
      : null;

  if (!ready || !summary) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonHero title={CASH_COPY.titleCaja} />
        <SkeletonRows />
      </div>
    );
  }

  const open = summary.session != null && !summary.closed;
  const closed = summary.closed;
  const noSession = summary.session == null;
  const diff = summary.counted != null ? summary.counted - summary.expected.efectivo : null;

  const metrics: MetricItem[] = [
    { icon: "plus", label: CASH_COPY.entradas, value: formatCop(summary.entradas), tone: "ok" },
    { icon: "cash", label: CASH_COPY.salidas, value: formatCop(summary.salidas), tone: "danger" },
  ];
  if (closed || summary.counted != null) {
    metrics.push({
      icon: "check",
      // S7: short label; difference goes on its own line so the 3rd cell fits at 360.
      label: CASH_COPY.contado,
      value: summary.counted != null ? formatCop(summary.counted) : "—",
      detail: diff != null ? (diff !== 0 ? `${differenceLabel(diff)} ${formatCop(Math.abs(diff))}` : differenceLabel(diff)) : undefined,
      tone: diff != null && diff < 0 ? "danger" : "neutral",
    });
  }

  const notices = (
    <>
      {summary.pendingCount > 0 && (
        <StateBlock
          kind="offline-miss"
          title={
            summary.pendingCount === 1
              ? "Tienes una caja pendiente de gestionar"
              : `Tienes ${summary.pendingCount} cajas pendientes`
          }
          action={
            <OfflineLink href="/mas/caja/gestionar" className="text-sm font-semibold text-ink underline underline-offset-2">
              Gestionar cajas
            </OfflineLink>
          }
        />
      )}
      {summary.needsReviewCount > 0 && (
        <StateBlock kind="offline-miss" title="Hay movimientos sin caja. Revísalos en Gestionar cajas." />
      )}
    </>
  );

  if (noSession) {
    return (
      <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
        <HeroBlock size="medium" back={{ href: "/mas", label: "Volver a Más" }} title={CASH_COPY.titleCaja} subtitle={shortDay(summary.localDate)} offline={band}>
          <p className="mt-5 text-2xl font-semibold">{CASH_COPY.estadoCerrada}</p>
          <p className="mt-1 text-sm text-on-hero-muted">{CASH_COPY.emptyCerrada}</p>
        </HeroBlock>
        <Sheet>
          {notices}
          <AmountField
            label={`Base · ${CASH_COPY.conCuantoAbres}`}
            value={openingRaw}
            onChange={setOpeningRaw}
            hint={CASH_COPY.abrirCajaHint}
            error={error}
          />
        </Sheet>
        <ActionBar aboveNav primary={{ label: CASH_COPY.abrirCaja, onClick: () => void onAbrir(), busy }} />
        <ActionToast text={toast} />
        {rejected.dialog}
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="medium"
        back={{ href: "/mas", label: "Volver a Más" }}
        title={CASH_COPY.titleCaja}
        subtitle={`${shortDay(summary.localDate)} · ${closed ? CASH_COPY.estadoCerrada : CASH_COPY.estadoAbierta}`}
        offline={band}
        action={open ? <HeroPill label={CASH_COPY.cerrarCaja} href="/mas/caja/cerrar" /> : undefined}
      >
        <div className="mt-5">
          <HeroAmount
            label="Efectivo esperado"
            value={formatCop(summary.expected.efectivo)}
            caption={`Nequi ${formatCop(summary.expected.nequi)} · Total ${formatCop(summary.expected.total)}`}
          />
          <p className="mt-2 text-xs text-on-hero-muted">Nequi no cuenta en billetes de cierre.</p>
        </div>
      </HeroBlock>

      <Sheet>
        {notices}
        {closed ? <RowGroupNote>{CASH_COPY.elDiaEstaCerrado}</RowGroupNote> : null}
        <SegmentedMetrics label="Entradas y salidas" items={metrics} />
        {open ? (
          <QuickTiles
            tiles={[
              { href: "/mas/caja/aporte", label: "Aporte", icon: "plus" },
              { href: "/mas/caja/retiro", label: "Retiro", icon: "cash" },
              { href: "/mas/gastos/nuevo", label: "Gasto", icon: "bag" },
            ]}
          />
        ) : null}
        <section className="flex flex-col gap-2">
          <SectionHead title="Movimientos" />
          {summary.moves.length === 0 ? (
            <RowGroupNote>{open ? CASH_COPY.emptyAbierta : CASH_COPY.emptyCerrada}</RowGroupNote>
          ) : (
            <RowGroup label="Movimientos">
              {summary.moves
                .slice()
                .reverse()
                .map((m) => {
                  const sg = moveSign(m);
                  return (
                    <Row
                      key={m.id}
                      title={kindLabel(m.kind)}
                      meta={m.method}
                      trailing={
                        <>
                          <span className={`text-[15px] font-semibold tabular-nums ${sg.tone === "ok" ? "text-ok" : "text-danger"}`}>
                            {sg.sign} {formatCop(m.amount)}
                          </span>
                          <span className="text-xs text-ink-muted">{sg.word}</span>
                        </>
                      }
                    />
                  );
                })}
            </RowGroup>
          )}
        </section>
      </Sheet>
      <ActionToast text={toast} />
        {rejected.dialog}
    </div>
  );
}
