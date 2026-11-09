"use client";

/**
 * C04 — customer sheet money panel:
 * - W4 «Este abono se aplicó distinto» (owner: «Marcar revisado», T32).
 * - W3 saldo a favor chip; online «Aplicar» (W7) and owner-only
 *   «Devolver en dinero» (W8). Offline: information only (J3 / T34).
 * - W3 compras «Pendiente $X» / «Saldada» (openBalance from the server).
 */
import { useMemo, useRef, useState } from "react";
import { formatCop } from "@/domain/money";
import { errorText } from "@/domain/ux/user-message";
import { Button } from "@/components/ui/Button";
import { AmountField } from "@/components/ui/AmountField";
import { ChoiceSegmented } from "@/components/ui/ChoiceSegmented";
import { ABONO_METHODS } from "@/components/customers/clientes";
import { SectionHead } from "@/components/ui/SectionHead";
import { getPwaApi } from "@/data/pwa/api";
import { planAllocation } from "@/domain/allocation";
import type { CustomerMoneyState, OpenObligation } from "@/data/pwa/customer-allocations";
import type { PayMethod } from "@/domain/types";

function labelFor(obligations: OpenObligation[], a: { targetType: string; saleId: string | null; initialDebtId: string | null }) {
  if (a.targetType === "credit") return "Saldo a favor";
  const id = a.saleId ?? a.initialDebtId;
  return obligations.find((o) => o.id === id)?.label ?? (a.targetType === "sale" ? "Compra" : "Deuda anterior");
}

/** «Pendiente $X» / «Saldada» for a sale or initial debt (W3, W5, T22). */
export function openBalanceLabel(open: number): string {
  return open > 0 ? `Pendiente ${formatCop(open)}` : "Saldada";
}

export function CustomerCreditPanel(props: {
  customerId: string;
  customerName: string;
  money: CustomerMoneyState;
  online: boolean;
  onChanged: () => void;
}) {
  const { money } = props;
  const first = props.customerName.split(" ")[0] ?? props.customerName;
  const live = props.online && money.source === "server";
  const [sheet, setSheet] = useState<null | "apply" | "refund">(null);
  const [showAll, setShowAll] = useState(false);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const openList = money.obligations.filter((o) => o.open > 0);
  const shown = showAll ? money.obligations : openList;
  const pendingAdjusted = money.adjusted.filter((p) => !p.reviewedAt);

  return (
    <div className="flex flex-col gap-3">
      {pendingAdjusted.map((p) => {
        const requested = p.requestedSaleId
          ? money.obligations.find((o) => o.id === p.requestedSaleId)?.label ?? "esa compra"
          : "esa compra";
        const went = p.allocations.filter((a) => a.amount > 0).map((a) => labelFor(money.obligations, a));
        return (
          <section
            key={p.id}
            role="region"
            aria-label="Abono aplicado distinto"
            className="rounded-[var(--r-lg)] border border-warning/30 bg-warning-soft p-3"
          >
            <p className="text-sm font-semibold text-ink">Este abono se aplicó distinto</p>
            <p className="mt-1 text-sm text-ink">
              {`Pediste aplicarlo a ${requested}, pero ya estaba pagada cuando llegó. Se aplicó a: ${went.join(", ") || "saldo a favor"}.`}
            </p>
            {reviewError ? <p className="mt-1 text-sm text-danger">{reviewError}</p> : null}
            {money.isOwner && live ? (
              <Button
                variant="secondary"
                className="mt-2"
                disabled={reviewBusy === p.id}
                onClick={() => {
                  setReviewBusy(p.id);
                  setReviewError(null);
                  void getPwaApi()
                    .customers.reviewPayment(props.customerId, p.id)
                    .then(props.onChanged)
                    .catch((e: unknown) => setReviewError(errorText(e, "No se pudo marcar.")))
                    .finally(() => setReviewBusy(null));
                }}
              >
                Marcar revisado
              </Button>
            ) : null}
          </section>
        );
      })}

      {money.creditBalance > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <button
              type="button"
              onClick={() => setSheet("apply")}
              className="inline-flex min-h-11 items-center rounded-[var(--r-pill)] bg-ok-soft px-4 text-sm font-semibold text-ink"
            >
              {`Saldo a favor ${formatCop(money.creditBalance)} · Aplicar ›`}
            </button>
          ) : (
            <span className="inline-flex min-h-11 items-center rounded-[var(--r-pill)] bg-ok-soft px-4 text-sm font-semibold text-ink">
              {`Saldo a favor ${formatCop(money.creditBalance)} · se usa con conexión`}
            </span>
          )}
          {live && money.isOwner ? (
            <button
              type="button"
              onClick={() => setSheet("refund")}
              className="inline-flex min-h-11 items-center rounded-[var(--r-pill)] border border-border px-4 text-sm font-semibold text-ink"
            >
              Devolver en dinero
            </button>
          ) : null}
        </div>
      ) : null}

      {money.obligations.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="compras-head">
          <div id="compras-head" className="flex items-center justify-between">
            <SectionHead title={showAll ? "Todas" : `Compras abiertas (${openList.length})`} />
            <button type="button" className="min-h-11 text-xs font-semibold text-ink underline underline-offset-2" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Solo abiertas" : "Todas"}
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-ink-muted">{`${first} está al día.`}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-[var(--r-lg)] border border-border bg-surface">
              {shown.map((o) => (
                <li key={`${o.kind}:${o.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    {o.label}
                    <span className="block text-xs text-ink-muted">{`Total ${formatCop(o.original)}`}</span>
                  </span>
                  <span className={`rounded-[var(--r-pill)] px-2 py-1 text-xs font-semibold ${o.open > 0 ? "bg-warning-soft" : "bg-ok-soft"}`}>
                    {openBalanceLabel(o.open)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {money.source === "estimate" ? <p className="text-xs text-ink-muted">Estimado con los datos de este teléfono.</p> : null}
        </section>
      ) : null}

      {sheet === "apply" ? (
        <ApplyCreditSheet customerId={props.customerId} firstName={first} money={money} onClose={() => setSheet(null)} onDone={props.onChanged} />
      ) : null}
      {sheet === "refund" ? (
        <RefundCreditSheet customerId={props.customerId} firstName={first} money={money} onClose={() => setSheet(null)} onDone={props.onChanged} />
      ) : null}
    </div>
  );
}

function SheetFrame(props: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={props.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        className="w-full rounded-t-[var(--r-lg)] bg-bg p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-ink">{props.title}</h2>
        <div className="mt-3 flex flex-col gap-3">{props.children}</div>
      </div>
    </div>
  );
}

function ApplyCreditSheet(props: {
  customerId: string;
  firstName: string;
  money: CustomerMoneyState;
  onClose: () => void;
  onDone: () => void;
}) {
  const max = Math.min(props.money.creditBalance, props.money.debt);
  const [raw, setRaw] = useState(String(max > 0 ? max : ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<{ amount: string; key: string } | null>(null);
  const amount = Number.parseInt(raw || "0", 10);
  const plan = useMemo(() => {
    if (!Number.isInteger(amount) || amount <= 0 || amount > max) return null;
    try {
      return planAllocation({ amount, obligations: props.money.obligations, overflow: "credit", cap: props.money.debt });
    } catch {
      return null;
    }
  }, [amount, max, props.money]);
  const tooMuch = amount > props.money.creditBalance;
  return (
    <SheetFrame title="Aplicar saldo a favor" onClose={props.onClose}>
      <p className="text-sm text-ink">{`${props.firstName} tiene ${formatCop(props.money.creditBalance)} a favor`}</p>
      {props.money.debt <= 0 ? (
        <p className="text-sm text-ink-muted">{`${props.firstName} no debe nada; no hay a qué aplicarlo.`}</p>
      ) : (
        <>
          <AmountField
            label="¿Cuánto?"
            value={raw}
            onChange={setRaw}
            error={tooMuch ? `No alcanza el saldo a favor (${formatCop(props.money.creditBalance)}).` : error}
          />
          {plan ? (
            <div className="text-sm text-ink">
              <p>
                {"Así queda: "}
                {plan.lines
                  .filter((l) => l.targetType !== "credit")
                  .map((l) => `${props.money.obligations.find((o) => o.id === l.id)?.label ?? ""} ${l.openBefore}→${l.openAfter}`)
                  .join(" · ")}
              </p>
              <p className="font-semibold">{`Deuda ${formatCop(props.money.debt)} → ${formatCop(props.money.debt - plan.toObligations)}`}</p>
            </div>
          ) : null}
          <p className="text-xs text-ink-muted">No mueve dinero de la caja.</p>
        </>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={props.onClose}>
          Cancelar
        </Button>
        <Button
          className="flex-1"
          disabled={busy || !plan || tooMuch}
          onClick={() => {
            if (!plan) return;
            setBusy(true);
            setError(null);
            if (!keyRef.current || keyRef.current.amount !== raw) keyRef.current = { amount: raw, key: crypto.randomUUID() };
            void getPwaApi()
              .customers.applyCredit(props.customerId, { amount }, keyRef.current.key)
              .then(() => {
                props.onClose();
                props.onDone();
              })
              .catch((e: unknown) => setError(errorText(e, "No se pudo aplicar.")))
              .finally(() => setBusy(false));
          }}
        >
          {`Aplicar ${Number.isInteger(amount) && amount > 0 ? formatCop(amount) : ""}`.trim()}
        </Button>
      </div>
    </SheetFrame>
  );
}

function RefundCreditSheet(props: {
  customerId: string;
  firstName: string;
  money: CustomerMoneyState;
  onClose: () => void;
  onDone: () => void;
}) {
  const [raw, setRaw] = useState(String(props.money.creditBalance));
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const amount = Number.parseInt(raw || "0", 10);
  const valid = Number.isInteger(amount) && amount > 0 && amount <= props.money.creditBalance;
  return (
    <SheetFrame title="Devolver saldo a favor" onClose={props.onClose}>
      {!confirming ? (
        <>
          <AmountField
            label="¿Cuánto?"
            value={raw}
            onChange={setRaw}
            error={amount > props.money.creditBalance ? `No alcanza el saldo a favor (${formatCop(props.money.creditBalance)}).` : error}
          />
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">¿Cómo?</p>
            <ChoiceSegmented label="¿Cómo?" options={ABONO_METHODS} value={method} onChange={setMethod} />
          </div>
          <p className="text-xs text-ink-muted">Sale de la caja de hoy.</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={props.onClose}>
              Cancelar
            </Button>
            <Button className="flex-1" disabled={!valid} onClick={() => setConfirming(true)}>
              Continuar
            </Button>
          </div>
        </>
      ) : (
        <div role="alertdialog" aria-label="Confirmar devolución" className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-ink">{`¿Devolver ${formatCop(amount)} a ${props.firstName} en ${method}?`}</p>
          <p className="text-sm text-ink-muted">Queda registrado como salida de caja.</p>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError(null);
                const sig = `${amount}|${method}`;
                if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: crypto.randomUUID() };
                void getPwaApi()
                  .customers.refundCredit(props.customerId, { amount, method }, keyRef.current.key)
                  .then(() => {
                    props.onClose();
                    props.onDone();
                  })
                  .catch((e: unknown) => setError(errorText(e, "No se pudo devolver.")))
                  .finally(() => setBusy(false));
              }}
            >
              {`Devolver ${formatCop(amount)}`}
            </Button>
          </div>
        </div>
      )}
    </SheetFrame>
  );
}
