"use client";

import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useMemo, useRef, useState } from "react";
import { CASH_COPY } from "@/domain/cash";
import { validateGasto } from "@/domain/cash";
import { newRequestId } from "@/domain/requestId";
import type { PayMethod } from "@/domain/types";
import { cashStore } from "@/store/cashStore";

export default function NuevoGastoPage() {
  const router = useRouter();
  const [amountRaw, setAmountRaw] = useState("");
  const [categoryRaw, setCategoryRaw] = useState("");
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  const valid = useMemo(
    () =>
      validateGasto({ amountRaw, categoryRaw, method }) === null,
    [amountRaw, categoryRaw, method],
  );

  async function confirm() {
    if (busy) return;
    setError(null);
    const err = validateGasto({ amountRaw, categoryRaw, method });
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      if (!requestIdRef.current) requestIdRef.current = newRequestId("gasto");
      await cashStore.recordGasto({
        amountRaw,
        categoryRaw,
        method,
        note,
        requestId: requestIdRef.current,
      });
      setToast(CASH_COPY.toastGasto);
      setTimeout(() => navigateOfflineAware(router, "/mas/gastos"), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/mas/gastos"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">{CASH_COPY.registrarGasto}</h1>
      </header>

      <p className="text-sm text-ink-muted">{CASH_COPY.gastoHelper}</p>
      <p className="text-sm font-medium text-ink-muted">{CASH_COPY.gastoCaption}</p>

      <Card className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium" htmlFor="monto">
            {CASH_COPY.monto}
          </label>
          <Input
            id="monto"
            inputMode="numeric"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value.replace(/\D/g, ""))}
            className="mt-2"
            placeholder="0"
          />
        </div>

        <div>
          <label className="text-sm font-medium" htmlFor="concepto">
            {CASH_COPY.enQueSeGasto}
          </label>
          <Input
            id="concepto"
            value={categoryRaw}
            onChange={(e) => setCategoryRaw(e.target.value)}
            className="mt-2"
            placeholder="transporte, arriendo…"
          />
        </div>

        <div>
          <p className="text-sm font-semibold">{CASH_COPY.comoPagaste}</p>
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
          <Input
            id="nota"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-2"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            type="button"
            variant="primary"
            disabled={!valid || busy}
            onClick={() => void confirm()}
            className="w-full"
          >
            {CASH_COPY.confirmarGasto}
          </Button>
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
      className={`min-h-11 rounded-[var(--r-md)] border px-2 text-sm font-semibold ${
        active
          ? "border-primary bg-primary text-ink"
          : "border-border bg-surface text-ink-muted"
      }`}
    >
      {label}
    </button>
  );
}
