"use client";

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
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { ActionToast } from "@/components/ui/ActionToast";

export default function RegistrarAbonoPage() {
  const offlineBand = useOfflineBand();
  const router = useRouter();
  const id = useEntityId();
  const [customer, setCustomer] = useState<RemoteCustomer | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  usePrefill("monto", setAmountRaw);
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [pendingSync, setPendingSync] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const c = await customerStore.getCustomer(id);
    setCustomer(c ?? null);
    if (c) {
      void getPendingCustomerIds().then((ids) =>
        setPendingSync(ids.includes(c.id)),
      );
    }
    setReady(true);
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

  const canSubmit = useMemo(() => {
    if (!customer) return false;
    return (
      validateAbono({
        amountRaw,
        debt: customer.debt,
        method,
      }) === null
    );
  }, [customer, amountRaw, method]);

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
    setBusy(true);
    try {
      if (!requestIdRef.current) {
        requestIdRef.current = crypto.randomUUID();
      }
      const result = await customerStore.recordAbono({
        customerId: customer.id,
        amountRaw,
        method,
        requestId: requestIdRef.current,
      });
      setToast(
        result.mode === "offline"
          ? "Abono guardado sin conexión"
          : "Abono registrado",
      );
      setTimeout(() => {
        navigateOfflineAware(router, `/clientes/${customer.id}`);
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al registrar abono");
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

        {helper ? (
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
    </div>
  );
}
