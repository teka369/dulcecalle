"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { CASH_COPY, validateCashAmount } from "@/domain/cash";
import { newRequestId } from "@/domain/requestId";
import type { PayMethod } from "@/domain/types";
import { cashStore } from "@/store/cashStore";

export default function AportePage() {
  const router = useRouter();
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const valid = useMemo(
    () => validateCashAmount({ amountRaw, method }) === null,
    [amountRaw, method],
  );

  async function confirm() {
    if (busy) return;
    setError(null);
    const err = validateCashAmount({ amountRaw, method });
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      if (!requestIdRef.current) requestIdRef.current = newRequestId("aporte");
      await cashStore.recordAporte({
        amountRaw,
        method,
        note,
        requestId: requestIdRef.current,
      });
      setToast(CASH_COPY.toastAporte);
      setTimeout(() => router.push("/mas/caja"), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/mas/caja"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">{CASH_COPY.aporteCapital}</h1>
      </header>

      <p className="text-sm text-ink/70">{CASH_COPY.aporteHelper}</p>
      <p className="text-sm font-medium text-ink/80">{CASH_COPY.aporteCaption}</p>

      <section className="flex flex-col gap-4 rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <div>
          <label className="text-sm font-medium" htmlFor="monto">
            {CASH_COPY.monto}
          </label>
          <input
            id="monto"
            inputMode="numeric"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value.replace(/\D/g, ""))}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            placeholder="0"
          />
        </div>

        <div>
          <p className="text-sm font-semibold">{CASH_COPY.comoAportas}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <MethodButton
              label="Efectivo"
              active={method === "Efectivo"}
              onClick={() => setMethod("Efectivo")}
            />
            <MethodButton
              label="Nequi"
              active={method === "Nequi"}
              onClick={() => setMethod("Nequi")}
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="nota">
            {CASH_COPY.nota}
          </label>
          <input
            id="nota"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void confirm()}
            className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            {CASH_COPY.confirmarAporte}
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

function MethodButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-[14px] border px-2 text-sm font-semibold ${
        active
          ? "border-primary bg-primary text-ink"
          : "border-ink/10 bg-surface text-ink/70"
      }`}
    >
      {label}
    </button>
  );
}
