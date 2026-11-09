"use client";

/**
 * C07 W3 / W4 — abonos of a customer (server ledger) with «Anular pago» and
 * «Corregir pago» (owner + online), «Anulado» badges and the
 * «Reemplaza a / Reemplazada por» links of decision 21.
 */
import { useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import { AmountField } from "@/components/ui/AmountField";
import { ChoiceSegmented } from "@/components/ui/ChoiceSegmented";
import { SectionHead } from "@/components/ui/SectionHead";
import { ABONO_METHODS } from "@/components/customers/clientes";
import { ReversalSheet } from "@/components/reversal/ReversalSheet";
import { correctPaymentPreview } from "@/components/reversal/correct-preview";
import { getPwaApi } from "@/data/pwa/api";
import { listCachedCustomers } from "@/data/pwa/catalog";
import { dayLabel, type CustomerMoneyState, type LedgerPayment } from "@/data/pwa/customer-allocations";
import { localDateKey } from "@/domain/cash/day";
import { OFFLINE_REVERSAL_TEXT, reversalActionState, reversalBadge } from "@/domain/reversal";
import type { PayMethod } from "@/domain/types";

export function CustomerPaymentsPanel(props: {
  customerId: string;
  customerName: string;
  money: CustomerMoneyState;
  online: boolean;
  onChanged: () => void;
}) {
  const payments = props.money.payments ?? [];
  const [sheet, setSheet] = useState<null | { kind: "reverse" | "correct"; payment: LedgerPayment }>(null);
  const [done, setDone] = useState<string | null>(null);
  if (payments.length === 0) return null;
  const first = props.customerName.split(" ")[0] ?? props.customerName;
  const live = props.online && props.money.source === "server";
  const byId = new Map(payments.map((p) => [p.id, p]));

  return (
    <section className="flex flex-col gap-2" aria-labelledby="abonos-head">
      <div id="abonos-head">
        <SectionHead title="Abonos" />
      </div>
      {done ? (
        <p role="status" className="rounded-[var(--r-lg)] bg-ok-soft px-3 py-2.5 text-sm text-ink">
          {done}
        </p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border rounded-[var(--r-lg)] border border-border bg-surface">
        {payments.map((p) => {
          const state = reversalActionState({ isOwner: props.money.isOwner, online: live, reversed: !!p.reversal });
          return (
            <li key={p.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>
                  {`Abono ${dayLabel(p.occurredOn)} · ${p.method}`}
                  {p.replacesPaymentId ? (
                    <span className="block text-xs text-ink-muted">
                      {`Reemplaza a ${byId.has(p.replacesPaymentId) ? `abono ${dayLabel(byId.get(p.replacesPaymentId)!.occurredOn)}` : "un abono de otro cliente"}`}
                    </span>
                  ) : null}
                  {p.replacedByPaymentId ? (
                    <span className="block text-xs text-ink-muted">
                      {`Reemplazada por ${byId.has(p.replacedByPaymentId) ? `abono ${dayLabel(byId.get(p.replacedByPaymentId)!.occurredOn)}` : "un abono de otro cliente"}`}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`font-semibold tabular-nums ${p.reversal ? "text-ink-muted line-through" : "text-ink"}`}
                  aria-label={p.reversal ? `${formatCop(p.amount)}, anulado` : undefined}
                >
                  {formatCop(p.amount)}
                </span>
              </div>
              {p.reversal ? (
                <span className="self-start rounded-[var(--r-pill)] bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-muted">
                  {`${reversalBadge("payment", p.reversal)}${p.reversal.number ? ` · ${p.reversal.number}` : ""}`}
                </span>
              ) : null}
              {state !== "hidden" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-disabled={state === "disabled" ? "true" : undefined}
                    onClick={() => state === "enabled" && setSheet({ kind: "correct", payment: p })}
                    className={`inline-flex min-h-11 items-center rounded-[var(--r-pill)] border border-border px-3 text-xs font-semibold text-ink ${state === "disabled" ? "opacity-50" : ""}`}
                  >
                    Corregir pago
                  </button>
                  <button
                    type="button"
                    aria-disabled={state === "disabled" ? "true" : undefined}
                    onClick={() => state === "enabled" && setSheet({ kind: "reverse", payment: p })}
                    className={`inline-flex min-h-11 items-center rounded-[var(--r-pill)] px-3 text-xs font-semibold text-danger ${state === "disabled" ? "opacity-50" : ""}`}
                  >
                    Anular pago
                  </button>
                  {state === "disabled" ? <span className="text-xs text-ink-muted">{OFFLINE_REVERSAL_TEXT}</span> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {sheet?.kind === "reverse" ? (
        <ReversalSheet
          title={`Anular pago de ${formatCop(sheet.payment.amount)}`}
          kind="payment"
          ctaLabel="Anular pago"
          firstName={first}
          occurredOn={sheet.payment.occurredOn}
          today={localDateKey()}
          preview={(body) => getPwaApi().reversals.reversePayment(props.customerId, sheet.payment.id, body, { dryRun: true })}
          submit={(body, requestId) => getPwaApi().reversals.reversePayment(props.customerId, sheet.payment.id, body, { requestId })}
          onDone={(r) => {
            setDone(`Pago anulado · ${r.number ?? ""}`);
            props.onChanged();
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.kind === "correct" ? (
        <CorrectPaymentSheet
          customerId={props.customerId}
          firstName={first}
          payment={sheet.payment}
          onClose={() => setSheet(null)}
          onDone={(msg) => {
            setDone(msg);
            props.onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function CorrectPaymentSheet(props: {
  customerId: string;
  firstName: string;
  payment: LedgerPayment;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [raw, setRaw] = useState(String(props.payment.amount));
  const [method, setMethod] = useState<PayMethod>(props.payment.method === "Nequi" ? "Nequi" : "Efectivo");
  const [target, setTarget] = useState(props.customerId);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  // Decision 21 — the replacement abono carries its OWN requestId, stable
  // across retries of this sheet.
  const [replacementKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    void listCachedCustomers()
      .then((rows) => setCustomers(rows.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setCustomers([]));
  }, []);
  const amount = Number.parseInt(raw || "0", 10);
  const amountOk = Number.isInteger(amount) && amount > 0;
  const targetName = customers.find((c) => c.id === target)?.name ?? props.firstName;
  const replacement = { customerId: target, amount, method, requestId: replacementKey };
  return (
    <ReversalSheet
      title={`Corregir pago de ${formatCop(props.payment.amount)}`}
      kind="payment"
      ctaLabel="Corregir pago"
      firstName={props.firstName}
      occurredOn={props.payment.occurredOn}
      today={localDateKey()}
      defaultReason="monto_equivocado"
      extraError={amountOk ? null : "Escribe el monto del pago nuevo."}
      extraSignature={JSON.stringify([target, amount, method])}
      extra={
        <div className="flex flex-col gap-2 rounded-[var(--r-lg)] border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Pago de reemplazo</p>
          <label className="text-sm font-medium" htmlFor="corregir-cliente">
            Cliente
          </label>
          <select
            id="corregir-cliente"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="min-h-11 rounded-[var(--r-md)] border border-border bg-surface px-2 text-sm text-ink"
          >
            {customers.length === 0 ? <option value={props.customerId}>{props.firstName}</option> : null}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <AmountField label="Monto" value={raw} onChange={setRaw} />
          <ChoiceSegmented label="¿Cómo?" options={ABONO_METHODS} value={method} onChange={setMethod} />
          {amountOk ? (
            <p className="text-sm text-ink">
              {`Se anula el pago de ${formatCop(props.payment.amount)} y se registra uno nuevo de ${formatCop(amount)} a ${targetName}.`}
            </p>
          ) : null}
        </div>
      }
      replacementName={targetName.split(" ")[0] || targetName}
      preview={(body) => correctPaymentPreview(getPwaApi().reversals, props.customerId, props.payment.id, body, replacement)}
      submit={(body, requestId) =>
        getPwaApi().reversals.correctPayment(props.customerId, props.payment.id, { ...body, replacement }, { requestId })
      }
      onDone={(r) => props.onDone(`Pago corregido · ${r.number ?? ""}`)}
      onClose={props.onClose}
    />
  );
}
