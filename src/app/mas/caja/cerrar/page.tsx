"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import {
  CASH_COPY,
  differenceDetail,
  differenceLabel,
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
      setTimeout(() => router.push("/mas/caja"), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  if (!ready || !summary) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (summary.closed) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/mas/caja" className="text-sm text-ink/70">
          ← Caja
        </Link>
        <p className="text-sm">{CASH_COPY.elDiaEstaCerrado}</p>
      </div>
    );
  }

  if (!summary.session) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/mas/caja" className="text-sm text-ink/70">
          ← Caja
        </Link>
        <p className="text-sm">{CASH_COPY.emptyCerrada}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/mas/caja"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">{CASH_COPY.cerrarCaja}</h1>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-ink/[0.08] bg-white p-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
            {CASH_COPY.deberiaHaber} (Efectivo)
          </p>
          <p className="mt-1 text-2xl font-semibold">{formatCop(expectedEf)}</p>
          <p className="mt-1 text-xs text-ink/50">
            {CASH_COPY.esperado} Nequi: {formatCop(summary.expected.nequi)}{" "}
            (no cuenta en billetes)
          </p>
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="contado">
            {CASH_COPY.cuantoHay}
          </label>
          <input
            id="contado"
            inputMode="numeric"
            value={countedRaw}
            onChange={(e) => {
              setConfirmDiff(false);
              setCountedRaw(e.target.value.replace(/\D/g, ""));
            }}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            placeholder="0"
          />
        </div>

        {diff != null && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
              {CASH_COPY.diferencia}
            </p>
            <p className="mt-1 text-xl font-semibold">
              {diff === 0
                ? CASH_COPY.sinDiferencia
                : formatCop(Math.abs(diff))}
            </p>
            <p className="text-sm font-medium">
              {differenceLabel(diff)}
              {diff === 0 ? ` · ${differenceDetail(diff)}` : ""}
            </p>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            disabled={busy || countedRaw.trim() === ""}
            onClick={() => void confirm()}
            className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            {confirmDiff && diff !== 0
              ? CASH_COPY.cerrarConDiferencia
              : CASH_COPY.confirmarCierre}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
