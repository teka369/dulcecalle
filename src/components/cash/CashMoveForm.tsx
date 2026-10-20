"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefill } from "@/components/ui/use-prefill";
import { useRejectedCorrection } from "@/components/ui/use-rejected-correction";
import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { CASH_COPY, parseCopAmount, validateCashAmount, validateGasto } from "@/domain/cash";
import { formatCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import type { PayMethod } from "@/domain/types";
import { cashStore, useCash } from "@/store/cashStore";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { AmountField, amountInputInvalid } from "@/components/ui/AmountField";
import { ChoiceSegmented } from "@/components/ui/ChoiceSegmented";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { StateBlock } from "@/components/ui/StateBlock";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";
import { ABONO_METHODS } from "@/components/customers/clientes";
import { expectedAfter, type CashFormKind } from "./cash";

const CFG = {
  aporte: {
    title: CASH_COPY.aporteCapital,
    helper: CASH_COPY.aporteHelper,
    caption: CASH_COPY.aporteCaption,
    how: CASH_COPY.comoAportas,
    cta: CASH_COPY.confirmarAporte,
    toast: CASH_COPY.toastAporte,
    back: "/mas/caja",
  },
  retiro: {
    title: CASH_COPY.retiroPersonal,
    helper: CASH_COPY.retiroHelper,
    caption: CASH_COPY.retiroCaption,
    how: CASH_COPY.comoRetiras,
    cta: CASH_COPY.confirmarRetiro,
    toast: CASH_COPY.toastRetiro,
    back: "/mas/caja",
  },
  gasto: {
    title: CASH_COPY.registrarGasto,
    helper: CASH_COPY.gastoHelper,
    caption: CASH_COPY.gastoCaption,
    how: CASH_COPY.comoPagaste,
    cta: CASH_COPY.confirmarGasto,
    toast: CASH_COPY.toastGasto,
    back: "/mas/gastos",
  },
} as const;

/** Aporte / Retiro / Gasto: same store calls and validation each page used. */
export function CashMoveForm({ kind }: { kind: CashFormKind }) {
  const cfg = CFG[kind];
  const router = useRouter();
  const { summary } = useCash();
  const [amountRaw, setAmountRaw] = useState("");
  const [categoryRaw, setCategoryRaw] = useState("");
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  usePrefill("monto", setAmountRaw);
  const rejected = useRejectedCorrection();
  usePrefill("categoria", setCategoryRaw, "text");

  useEffect(() => {
    if (!cashStore.getSnapshot().summary) void cashStore.refresh().catch(() => undefined);
  }, []);

  const validate = () =>
    kind === "gasto" ? validateGasto({ amountRaw, categoryRaw, method }) : validateCashAmount({ amountRaw, method });
  const valid = validate() === null;

  const amount = parseCopAmount(amountRaw);
  const after = summary && amount != null && amount > 0 ? expectedAfter(summary.expected, kind, method, amount) : null;

  async function confirm() {
    if (amountInputInvalid()) return; // a rejected amount is on screen: never send
    if (busy) return;
    setError(null);
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      if (!requestIdRef.current) requestIdRef.current = newRequestId(kind);
      if (kind === "aporte") await cashStore.recordAporte({ amountRaw, method, note, requestId: requestIdRef.current });
      else if (kind === "retiro") await cashStore.recordRetiro({ amountRaw, method, note, requestId: requestIdRef.current });
      else await cashStore.recordGasto({ amountRaw, categoryRaw, method, note, requestId: requestIdRef.current });
      setToast(cfg.toast);
      rejected.afterSave(() => navigateOfflineAware(router, cfg.back), 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  const label = "text-xs font-semibold uppercase tracking-wide text-ink-muted";
  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock
        size="compact"
        back={{ href: cfg.back, label: "Volver" }}
        title={cfg.title}
        subtitle={summary ? `Efectivo esperado ${formatCop(summary.expected.efectivo)}` : cfg.caption}
      />
      <Sheet>
        <p className="text-sm text-ink-muted">
          {cfg.helper} <span className="font-medium">{cfg.caption}</span>
        </p>
        <AmountField label={CASH_COPY.monto} value={amountRaw} onChange={setAmountRaw} />
        {kind === "gasto" ? (
          <div>
            <label className={label} htmlFor="concepto">
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
        ) : null}
        <div className="flex flex-col gap-2">
          <p className={label}>{cfg.how}</p>
          <ChoiceSegmented label={cfg.how} options={ABONO_METHODS} value={method} onChange={setMethod} />
        </div>
        <div>
          <label className={label} htmlFor="nota">
            {CASH_COPY.nota}
          </label>
          <Input id="nota" value={note} onChange={(e) => setNote(e.target.value)} className="mt-2" />
        </div>
        {after ? (
          <RowGroup label="Resultado">
            <Row
              title={`Quedará en caja ${formatCop(method === "Efectivo" ? after.efectivo : after.nequi)} (${method})`}
              meta={`Total ${formatCop(after.total)}`}
            />
          </RowGroup>
        ) : null}
        {error ? <StateBlock kind="error" title={error} /> : null}
      </Sheet>
      <ActionBar primary={{ label: cfg.cta, onClick: () => void confirm(), disabled: !valid, busy }} />
      <ActionToast text={toast} />
      {rejected.dialog}
    </div>
  );
}
