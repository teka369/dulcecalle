"use client";

import { errorText } from "@/domain/ux/user-message";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { GASTOS_OFFLINE_NOCACHE, cashOfflineView, cashPageGate, sumAmounts } from "@/components/cash/cash";
import { StateBlock } from "@/components/ui/StateBlock";
import { useSync } from "@/store/syncStore";
import { usePrep } from "@/store/prepStore";
import { bogotaKey, dayHeading, groupByDay } from "@/components/sale/sales-list";
import { formatCop } from "@/domain/money";
import { CASH_COPY } from "@/domain/cash";
import type { RemoteExpense } from "@/data/http/mappers";
import { cashStore } from "@/store/cashStore";

export default function GastosPage() {
  const [expenses, setExpenses] = useState<RemoteExpense[]>([]);
  const [closed, setClosed] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { online } = useSync();
  const { lastReadyAt } = usePrep();

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const summary = await cashStore.refresh();
      setExpenses(cashStore.getSnapshot().expenses);
      setClosed(summary.closed);
      setHasSession(summary.session != null);
    } catch (e) {
      setLoadError(errorText(e, "No se pudo cargar."));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const total = useMemo(() => sumAmounts(expenses), [expenses]);
  const days = useMemo(() => groupByDay(expenses), [expenses]);
  const [todayKey] = useState(() => bogotaKey(Date.now()));

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonHero title={CASH_COPY.masGastos} />
        <SkeletonRows />
      </div>
    );
  }

  const canAdd = !closed && hasSession;
  const offlineView = cashOfflineView({ online, preparedAt: lastReadyAt, hasLocalData: hasSession || expenses.length > 0 });

  const gate = cashPageGate({ source: cashStore.getSnapshot().source, loadError, offlineView, hasLocalData: hasSession || expenses.length > 0 });
  if (gate !== "ok") {
    return (
      <div className="flex flex-col pb-6">
        <HeroBlock size="medium" back={{ href: "/mas", label: "Volver a Más" }} title={CASH_COPY.masGastos} offline={online ? null : { text: "Sin conexión" }} />
        <Sheet>
          <StateBlock
            kind={gate === "offline" ? "offline-miss" : "error"}
            title={gate === "offline" ? GASTOS_OFFLINE_NOCACHE.title : "No se pudo cargar."}
            body={gate === "offline" ? GASTOS_OFFLINE_NOCACHE.body : (loadError ?? undefined)}
            action={
              <button type="button" onClick={() => void load()} className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg">
                Reintentar
              </button>
            }
          />
        </Sheet>
      </div>
    );
  }

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="medium"
        back={{ href: "/mas", label: "Volver a Más" }}
        title={CASH_COPY.masGastos}
        offline={offlineView === "offline-cache" ? (lastReadyAt != null ? { capturedAt: lastReadyAt } : { text: "Sin conexión · datos de este teléfono" }) : null}
        action={canAdd ? <HeroPill label="Nuevo gasto" href="/mas/gastos/nuevo" /> : undefined}
      >
        <div className="mt-5">
          <HeroAmount
            label="Total listado"
            value={formatCop(total)}
            caption={expenses.length === 1 ? "1 gasto" : `${expenses.length} gastos`}
          />
        </div>
      </HeroBlock>
      <Sheet>
        {closed ? <RowGroupNote>{CASH_COPY.elDiaEstaCerrado}</RowGroupNote> : null}
        {!closed && !hasSession ? <RowGroupNote>{CASH_COPY.emptyCerrada}</RowGroupNote> : null}
        {expenses.length === 0 ? (
          <RowGroupNote>Aún no hay gastos.</RowGroupNote>
        ) : (
          days.map((d) => (
            <section key={d.key} className="flex flex-col gap-2">
              <SectionHead title={dayHeading(d.key, todayKey)} />
              <RowGroup label={dayHeading(d.key, todayKey)}>
                {d.rows.map((e) => (
                  <Row
                    key={e.id}
                    title={e.category}
                    meta={[e.method, e.note].filter(Boolean).join(" · ")}
                    trailing={<span className="text-[15px] font-semibold tabular-nums text-ink">− {formatCop(e.amount)}</span>}
                  />
                ))}
              </RowGroup>
            </section>
          ))
        )}
      </Sheet>
    </div>
  );
}
