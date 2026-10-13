"use client";

import { OfflineLink } from "@/components/shell/OfflineLink";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { SegmentedMetrics, type MetricItem } from "@/components/ui/SegmentedMetrics";
import { QuickTiles } from "@/components/ui/QuickTiles";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { AmountField } from "@/components/ui/AmountField";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";
import { kindLabel, moveSign, shortDay } from "@/components/cash/cash";
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
      <div className="flex flex-col gap-4">
        <SkeletonHero />
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
      label: diff != null ? `${CASH_COPY.contado} · ${differenceLabel(diff)}` : CASH_COPY.contado,
      value: summary.counted != null ? formatCop(summary.counted) : "—",
      detail: diff != null && diff !== 0 ? `${CASH_COPY.diferencia} ${formatCop(Math.abs(diff))}` : undefined,
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
        <HeroBlock size="medium" back={{ href: "/mas", label: "Volver a Más" }} title={CASH_COPY.titleCaja} subtitle={shortDay(summary.localDate)}>
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
    </div>
  );
}
