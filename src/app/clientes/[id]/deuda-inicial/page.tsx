"use client";

import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
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
import { AmountField } from "@/components/ui/AmountField";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { ActionToast } from "@/components/ui/ActionToast";

export default function AgregarDeudaAnteriorPage() {
  const router = useRouter();
  const id = useEntityId();
  const [customer, setCustomer] = useState<RemoteCustomer | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const c = await customerStore.getCustomer(id);
    setCustomer(c ?? null);
    setReady(true);
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
      setTimeout(() => {
        navigateOfflineAware(router, `/clientes/${customer.id}`);
      }, 700);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Error al registrar la deuda anterior",
      );
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonHero title="Deuda anterior" />
        <SkeletonRows rows={3} />
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
    </div>
  );
}
