"use client";

import { Spinner } from "@/components/ui/Spinner";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { AmountField, amountInputInvalid } from "@/components/ui/AmountField";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { StateBlock } from "@/components/ui/StateBlock";
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

export default function CerrarCajaPage() {
  const router = useRouter();
  const [summary, setSummary] = useState<DayCashSummary | null>(null);
  const [countedRaw, setCountedRaw] = useState("");
  const [confirmDiff, setConfirmDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const s = await cashStore.refresh();
    setSummary(s);
    setReady(true);
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

  async function confirm() {
    if (amountInputInvalid()) return; // a rejected amount is on screen: never send
    if (busy || !summary) return;
    setError(null);
    const err = validateCounted(countedRaw);
    if (err) {
      setError(err);
      return;
    }
    if (diff != null && diff !== 0 && !confirmDiff) {
      setError(CASH_COPY.cerrarConDiferencia);
      setConfirmDiff(true);
      return;
    }
    setBusy(true);
    try {
      await cashStore.closeCaja(countedRaw);
      setToast(CASH_COPY.toastCajaCerrada);
      setTimeout(() => navigateOfflineAware(router, "/mas/caja"), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
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

  const back = { href: "/mas/caja", label: "Volver a Caja" };
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
