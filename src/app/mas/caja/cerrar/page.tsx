"use client";

import { errorText } from "@/domain/ux/user-message";
import { Spinner } from "@/components/ui/Spinner";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { AmountField, amountInputInvalid } from "@/components/ui/AmountField";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { StateBlock } from "@/components/ui/StateBlock";
import { ListErrorState } from "@/components/ui/ListErrorState";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";
import { closeDifference } from "@/components/cash/cash";
import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import {
  CASH_COPY,
  parseCopAmount,
  validateCounted,
} from "@/domain/cash";
import type { DayCashSummary } from "@/store/cashStore";
import { cashStore } from "@/store/cashStore";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { getPwaAuthSession } from "@/data/http/session";
import { listUnresolvedFinancialOps, unresolvedTotals } from "@/data/pwa/unresolved-financial";

type Totals = ReturnType<typeof unresolvedTotals>;

export default function CerrarCajaPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DayCashSummary | null>(null);
  const [countedRaw, setCountedRaw] = useState("");
  const [confirmDiff, setConfirmDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [confirmAnyway, setConfirmAnyway] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await cashStore.refresh();
      if (
        cashStore.getSnapshot().source === "local" &&
        !s.session &&
        (typeof navigator === "undefined" || navigator.onLine !== false)
      ) {
        setLoadError("El servidor no respondió. Tus datos no se han perdido.");
        return;
      }
      setSummary(s);
      const businessId = getPwaAuthSession().businessId;
      if (businessId) {
        // C01 / DC-01 — money ops not confirmed by the server are shown before closing.
        setTotals(unresolvedTotals(await listUnresolvedFinancialOps(businessId)));
      }
    } catch (e: unknown) {
      setLoadError(errorText(e, ""));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counted = useMemo(() => {
    if (countedRaw.trim() === "") return null;
    return parseCopAmount(countedRaw);
  }, [countedRaw]);

  const expectedEf = summary?.expected.efectivo ?? 0;
  const diff = counted != null ? counted - expectedEf : null;

  async function confirm(closeAnyway = false) {
    if (amountInputInvalid()) return; // a rejected amount is on screen: never send
    if (busy || !summary) return;
    setError(null);
    const err = validateCounted(countedRaw);
    if (err) {
      setError(err);
      return;
    }
    if (!closeAnyway && totals && totals.rejectedCount > 0) {
      setConfirmAnyway(true);
      return;
    }
    if (diff != null && diff !== 0 && !confirmDiff) {
      setError(CASH_COPY.cerrarConDiferencia);
      setConfirmDiff(true);
      return;
    }
    setBusy(true);
    try {
      await cashStore.closeCaja(countedRaw, closeAnyway ? { closeAnyway: true } : {});
      setToast(CASH_COPY.toastCajaCerrada);
      setTimeout(() => navigateOfflineAware(router, "/mas/caja"), 700);
    } catch (e) {
      setError(errorText(e, "Error"));
      setBusy(false);
    }
  }

  const back = { href: "/mas/caja", label: "Volver a Caja" };
  if (ready && loadError !== null) {
    return (
      <div className="flex flex-col pb-6">
        <HeroBlock size="compact" back={back} title={CASH_COPY.cerrarCaja} />
        <Sheet>
          <ListErrorState
            message={loadError}
            online={typeof navigator === "undefined" || navigator.onLine}
            onRetry={() => {
              setReady(false);
              void load();
            }}
          />
        </Sheet>
      </div>
    );
  }

  if (!ready || !summary) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (summary.closed || !summary.session) {
    return (
      <HeroBlock size="compact" back={back} title={CASH_COPY.cerrarCaja}>
        <StateBlock onHero kind="empty" title={summary.closed ? CASH_COPY.elDiaEstaCerrado : CASH_COPY.emptyCerrada} />
      </HeroBlock>
    );
  }

  const live = closeDifference(counted, expectedEf);

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock
        size="compact"
        back={back}
        title={CASH_COPY.cerrarCaja}
        subtitle={`${CASH_COPY.esperado} ${formatCop(expectedEf)} (Efectivo) · Nequi ${formatCop(summary.expected.nequi)} no cuenta en billetes`}
      />
      <Sheet>
        <AmountField
          label="¿Cuánto efectivo hay?"
          value={countedRaw}
          onChange={(v) => {
            setConfirmDiff(false);
            setCountedRaw(v);
          }}
        />
        {live ? (
          <RowGroup label={CASH_COPY.diferencia}>
            <Row
              title={live.diff === 0 ? `${CASH_COPY.diferencia}: ${CASH_COPY.sinDiferencia}` : `${CASH_COPY.diferencia}: ${live.word} ${formatCop(live.abs)}`}
              trailing={
                <span className={`flex items-center gap-1.5 text-sm font-semibold ${live.tone === "ok" ? "text-ok" : "text-danger"}`}>
                  <span aria-hidden className={`size-2 rounded-full ${live.tone === "ok" ? "bg-ok" : "bg-danger"}`} />
                  {live.word}
                </span>
              }
            />
          </RowGroup>
        ) : null}
        {totals && totals.pendingCount > 0 ? (
          <p role="status" className="rounded-[var(--r-lg)] border border-warning bg-warning-soft p-3 text-sm" data-testid="close-pending-warning">
            {totals.pendingCount === 1
              ? `1 operación de dinero (${formatCop(totals.pendingAmount)}) todavía no llega al servidor. Puedes cerrar: se enviará cuando haya conexión.`
              : `${totals.pendingCount} operaciones de dinero (${formatCop(totals.pendingAmount)}) todavía no llegan al servidor. Puedes cerrar: se enviarán cuando haya conexión.`}
          </p>
        ) : null}
        {totals && totals.rejectedCount > 0 ? (
          <section className="rounded-[var(--r-lg)] border border-danger bg-danger-soft p-3" data-testid="close-rejected-card">
            <p className="text-sm font-semibold text-danger">
              {totals.rejectedCount === 1
                ? `1 operación de dinero rechazada (${formatCop(totals.rejectedAmount)})`
                : `${totals.rejectedCount} operaciones de dinero rechazadas (${formatCop(totals.rejectedAmount)})`}
            </p>
            <p className="mt-1 text-sm">El servidor no las aceptó. Resuélvelas antes de cerrar o cierra igual.</p>
            <Link href="/sincronizacion" className="mt-2 inline-block text-sm font-semibold underline">
              {`Resolver (${totals.rejectedCount})`}
            </Link>
            {confirmAnyway ? (
              <div role="alertdialog" aria-labelledby="cerrar-igual-title" className="mt-3 flex flex-col gap-2">
                <p id="cerrar-igual-title" className="text-sm font-semibold">
                  ¿Cerrar igual? El cierre quedará marcado con {totals.rejectedCount} sin resolver ({formatCop(totals.rejectedAmount)}).
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setConfirmAnyway(false)} disabled={busy}>
                    Volver
                  </Button>
                  <Button onClick={() => void confirm(true)} disabled={busy}>
                    Cerrar igual
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        {error ? <StateBlock kind="error" title={error} /> : null}
      </Sheet>
      <ActionBar
        primary={{
          label: confirmDiff && diff !== 0 ? CASH_COPY.cerrarConDiferencia : CASH_COPY.cerrarCaja,
          onClick: () => void confirm(),
          disabled: countedRaw.trim() === "",
          busy,
        }}
      />
      <ActionToast text={toast} />
    </div>
  );
}
