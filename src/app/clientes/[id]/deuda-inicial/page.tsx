"use client";

import { errorText } from "@/domain/ux/user-message";
import { useRouter } from "next/navigation";
import { isOffline, navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INITIAL_DEBT_TOAST,
  parseInitialDebtAmount,
  validateInitialDebtAmount,
} from "@/domain/initialDebt";
import { formatCop } from "@/domain/money";
import type { RemoteCustomer } from "@/data/http/mappers";
import { useEntityId } from "@/components/shell/entity-route";
import { customerStore } from "@/store/customerStore";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { AmountField, amountInputInvalid } from "@/components/ui/AmountField";
import { usePrefill } from "@/components/ui/use-prefill";
import { useRejectedCorrection } from "@/components/ui/use-rejected-correction";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { StateBlock } from "@/components/ui/StateBlock";
import { ListErrorState } from "@/components/ui/ListErrorState";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { ActionToast } from "@/components/ui/ActionToast";

const INITIAL_DEBT_OFFLINE_TEXT = "Necesitas internet para registrar deuda inicial";

export default function AgregarDeudaAnteriorPage() {
  const router = useRouter();
  const id = useEntityId();
  const [customer, setCustomer] = useState<RemoteCustomer | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  usePrefill("monto", setAmountRaw);
  const rejected = useRejectedCorrection();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const [offline, setOffline] = useState(false);

  // Registering an opening balance needs the server: offline shows its own state.
  useEffect(() => {
    const sync = () => setOffline(isOffline());
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    setLoadError(null);
    try {
      const c = await customerStore.getCustomer(id);
      setCustomer(c ?? null);
    } catch (e: unknown) {
      setLoadError(errorText(e, ""));
    } finally {
      setReady(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmit = useMemo(() => {
    if (!customer) return false;
    return validateInitialDebtAmount(amountRaw) === null;
  }, [customer, amountRaw]);

  const preview = useMemo(() => {
    if (!customer) return null;
    if (validateInitialDebtAmount(amountRaw) !== null) return null;
    const amount = parseInitialDebtAmount(amountRaw);
    return customer.debt + amount;
  }, [customer, amountRaw]);

  async function confirm() {
    if (amountInputInvalid()) return; // a rejected amount is on screen: never send
    if (!customer || busy) return;
    setError(null);
    const err = validateInitialDebtAmount(amountRaw);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    try {
      if (!requestIdRef.current) {
        requestIdRef.current = crypto.randomUUID();
      }
      const result = await customerStore.recordInitialDebt({
        customerId: customer.id,
        amountRaw,
        requestId: requestIdRef.current,
      });
      setToast(
        result.mode === "offline"
          ? "Deuda anterior guardada sin conexión"
          : INITIAL_DEBT_TOAST,
      );
      rejected.afterSave(() => {
        navigateOfflineAware(router, `/clientes/${customer.id}`);
      }, 700);
    } catch (e) {
      setError(
        errorText(e, "Error al registrar la deuda anterior"),
      );
      setBusy(false);
    }
  }

  if (offline && id) {
    return (
      <div className="flex flex-col">
        <HeroBlock
          size="compact"
          back={{ href: `/clientes/${id}`, label: "Volver al cliente", entity: true }}
          title="Agregar deuda anterior"
          offline={{ text: "Sin conexión" }}
        />
        <Sheet>
          <div role="status" className="flex flex-col gap-4 py-2" data-testid="deuda-inicial-offline">
            <p className="text-base font-semibold text-ink">{INITIAL_DEBT_OFFLINE_TEXT}</p>
            <button
              type="button"
              onClick={() => navigateOfflineAware(router, `/clientes/${id}`, { replace: true })}
              className="inline-flex h-11 min-h-11 w-full items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg hover:opacity-[0.92]"
            >
              Volver al cliente
            </button>
          </div>
        </Sheet>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonHero title="Deuda anterior" />
        <SkeletonRows rows={3} />
      </div>
    );
  }

  if (loadError !== null) {
    return (
      <div className="flex flex-col">
        <HeroBlock size="compact" back={{ href: "/clientes", label: "Volver a Clientes", entity: true }} title="Agregar deuda anterior" />
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
      <HeroBlock size="compact" back={{ href: "/clientes", label: "Volver a Clientes", entity: true }} title="Clientes">
        <StateBlock onHero kind="empty" title="No encontramos ese cliente." />
      </HeroBlock>
    );
  }

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock
        size="compact"
        back={{ href: `/clientes/${customer.id}`, label: "Volver al cliente", entity: true }}
        title="Agregar deuda anterior"
        subtitle={`${customer.name} · Debe ${formatCop(customer.debt)}`}
      />
      <Sheet>
        <AmountField
          label="Cuánto debía"
          value={amountRaw}
          onChange={setAmountRaw}
          error={error}
          hint="Lo que ya debía antes de usar DulceCalle. No es una venta: no mueve caja ni inventario."
        />
        {preview != null ? (
          <RowGroup label="Resultado">
            <Row title={`Quedará debiendo ${formatCop(preview)}`} />
          </RowGroup>
        ) : null}
      </Sheet>

      <ActionBar
        primary={{ label: "Agregar deuda anterior", onClick: () => void confirm(), disabled: !canSubmit, busy }}
      />
      <ActionToast text={toast} />
      {rejected.dialog}
    </div>
  );
}
