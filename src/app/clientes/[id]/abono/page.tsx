"use client";

import { errorText } from "@/domain/ux/user-message";
import { useOfflineBand } from "@/components/shell/use-online";
import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  parseAbonoAmount,
  validateAbono,
} from "@/domain/abono";
import { formatCop } from "@/domain/money";
import { ChoiceSegmented } from "@/components/ui/ChoiceSegmented";
import { ABONO_METHODS, abonoView } from "@/components/customers/clientes";
import type { PayMethod } from "@/domain/types";
import type { RemoteCustomer } from "@/data/http/mappers";
import { useEntityId } from "@/components/shell/entity-route";
import { getPendingCustomerIds } from "@/data/pwa/offline-catalog";
import { customerStore } from "@/store/customerStore";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { AmountField, amountInputInvalid } from "@/components/ui/AmountField";
import { usePrefill } from "@/components/ui/use-prefill";
import { payloadBoundRequestId, type PayloadBoundId } from "@/domain/requestId";
import { useRejectedCorrection } from "@/components/ui/use-rejected-correction";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { StateBlock } from "@/components/ui/StateBlock";
import { ListErrorState } from "@/components/ui/ListErrorState";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { ActionToast } from "@/components/ui/ActionToast";
import { loadCustomerMoneyState, type CustomerMoneyState } from "@/data/pwa/customer-allocations";
import { AbonoAllocationPicker } from "@/components/customers/AbonoAllocationPicker";
import { buildAbonoPreview, wireTarget, type AbonoChoice } from "@/components/customers/abono-target";
import type { Overflow } from "@/domain/allocation";

export default function RegistrarAbonoPage() {
  const offlineBand = useOfflineBand();
  const router = useRouter();
  const id = useEntityId();
  const [customer, setCustomer] = useState<RemoteCustomer | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  usePrefill("monto", setAmountRaw);
  const rejected = useRejectedCorrection();
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  // C04 W1 — where the abono goes; FIFO by default (5 taps, unchanged).
  const [money, setMoney] = useState<CustomerMoneyState | null>(null);
  const [choice, setChoice] = useState<AbonoChoice>({ mode: "fifo" });
  const [overflow, setOverflow] = useState<Overflow>("fifo");
  // C02 / NEW-01 — the requestId is bound to the payload (see payloadBoundRequestId).
  const boundIdRef = useRef<PayloadBoundId>(null);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    setLoadError(null);
    try {
      const c = await customerStore.getCustomer(id);
      setCustomer(c ?? null);
      if (c) {
        void getPendingCustomerIds().then((ids) =>
          setPendingSync(ids.includes(c.id)),
        );
        void loadCustomerMoneyState(c.id)
          .then((m) => {
            setMoney(m);
            // W6 «Registrar abono a esta compra» → «Una compra» preselected.
            const pre = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("compra");
            if (pre && m.obligations.some((o) => o.kind === "sale" && o.id === pre && o.open > 0)) {
              setChoice({ mode: "sale", obligationId: pre });
            }
          })
          .catch(() => setMoney(null));
      }
    } catch (e: unknown) {
      setLoadError(errorText(e, ""));
    } finally {
      setReady(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const amount = useMemo(() => {
    if (amountRaw.trim() === "") return null;
    const n = parseAbonoAmount(amountRaw);
    return Number.isFinite(n) ? n : null;
  }, [amountRaw]);

  const helper = useMemo(() => {
    if (!customer || amount == null) return null;
    return abonoView(customer.debt, amountRaw, method).remainingText;
  }, [customer, amount, amountRaw, method]);

  const preview = useMemo(() => {
    if (!customer || !money) return null;
    return buildAbonoPreview({
      amount,
      debt: customer.debt,
      obligations: money.obligations,
      choice,
      overflow,
    });
  }, [customer, money, amount, choice, overflow]);

  const choiceIncomplete =
    (choice.mode === "sale" && !choice.obligationId) ||
    (preview != null && (preview.error != null || Object.keys(preview.fieldErrors).length > 0));

  const canSubmit = useMemo(() => {
    if (!customer) return false;
    if (choiceIncomplete) return false;
    return (
      validateAbono({
        amountRaw,
        debt: customer.debt,
        method,
      }) === null
    );
  }, [customer, amountRaw, method, choiceIncomplete]);

  async function confirm() {
    if (amountInputInvalid()) return; // a rejected amount is on screen: never send
    if (!customer || busy) return;
    setError(null);
    const err = validateAbono({
      amountRaw,
      debt: customer.debt,
      method,
    });
    if (err) {
      setError(err);
      return;
    }
    if (choiceIncomplete) {
      setError(preview?.error ?? "Elige a qué compra se aplica.");
      return;
    }
    setBusy(true);
    try {
      const wire = money ? wireTarget(choice, money.obligations, overflow) : {};
      boundIdRef.current = payloadBoundRequestId(
        boundIdRef.current,
        // C02 — the target is part of the payload: another target = another key.
        JSON.stringify({
          customerId: customer.id,
          amount: amountRaw.replace(/\D/g, ""),
          method,
          ...(wire.target ? { target: wire.target, overflow: wire.overflow ?? "fifo" } : {}),
        }),
      );
      requestIdRef.current = boundIdRef.current.id;
      const result = await customerStore.recordAbono({
        customerId: customer.id,
        amountRaw,
        method,
        requestId: requestIdRef.current,
        ...wire,
      });
      const p = result.payment;
      setToast(
        result.mode === "offline"
          ? "Abono guardado sin conexión"
          : p?.adjusted
            ? "Abono registrado · se aplicó distinto"
            : p?.debtBefore != null && p.debtAfter != null
              ? `Abono registrado · Deuda ${formatCop(p.debtBefore)} → ${formatCop(p.debtAfter)}`
              : "Abono registrado",
      );
      rejected.afterSave(() => {
        navigateOfflineAware(router, `/clientes/${customer.id}`);
      }, 700, requestIdRef.current);
    } catch (e) {
      setError(errorText(e, "Error al registrar abono"));
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonHero title="Registrar abono" />
        <SkeletonRows rows={3} />
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div className="flex flex-col">
        <HeroBlock offline={offlineBand} size="compact" back={{ href: "/clientes", label: "Volver a Clientes", entity: true }} title="Registrar abono" />
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

  if (!customer) {
    return (
      <HeroBlock offline={offlineBand} size="compact" back={{ href: "/clientes", label: "Volver a Clientes", entity: true }} title="Clientes">
        <StateBlock onHero kind="empty" title="No encontramos ese cliente." />
      </HeroBlock>
    );
  }

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock offline={offlineBand}
        size="compact"
        back={{ href: `/clientes/${customer.id}`, label: "Volver al cliente", entity: true }}
        title="Registrar abono"
        subtitle={`${customer.name} · Debe ${formatCop(customer.debt)}`}
      />
      <Sheet>
        <div>
          <AmountField label="¿Cuánto abona?" value={amountRaw} onChange={setAmountRaw} error={error} />
          {customer.debt > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAmountRaw(String(customer.debt))}
                aria-pressed={amountRaw === String(customer.debt)}
                className="inline-flex min-h-11 items-center rounded-[var(--r-pill)] border border-border bg-surface px-4 text-sm font-semibold text-ink"
              >
                Todo {formatCop(customer.debt)}
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">¿Cómo recibes?</p>
          <ChoiceSegmented label="¿Cómo recibes?" options={ABONO_METHODS} value={method} onChange={setMethod} />
        </div>

        {money && preview ? (
          <AbonoAllocationPicker
            customerName={customer.name}
            debt={customer.debt}
            obligations={money.obligations}
            estimated={money.source === "estimate"}
            choice={choice}
            onChoice={setChoice}
            overflow={overflow}
            onOverflow={setOverflow}
            preview={preview}
            amount={amount}
          />
        ) : helper ? (
          <RowGroup label="Resultado">
            <Row title={helper} />
          </RowGroup>
        ) : null}

        {pendingSync && (
          <StateBlock
            kind="offline-miss"
            title="Cliente en sincronización"
            body="Este cliente aún se está sincronizando. Podrás registrar el abono en cuanto termine la sincronización."
          />
        )}
      </Sheet>

      <ActionBar
        primary={{
          label: "Registrar abono",
          onClick: () => void confirm(),
          disabled: !canSubmit || pendingSync,
          busy,
        }}
      />
      <ActionToast text={toast} />
      {rejected.dialog}
    </div>
  );
}
