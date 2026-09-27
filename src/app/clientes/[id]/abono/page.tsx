"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  abonoRemainingHelper,
  parseAbonoAmount,
  validateAbono,
} from "@/domain/abono";
import { formatCop } from "@/domain/money";
import type { PayMethod } from "@/domain/types";
import type { RemoteCustomer } from "@/data/http/mappers";
import { routeId } from "@/data/pwa/ids";
import { getPendingCustomerIds } from "@/data/pwa/offline-catalog";
import { customerStore } from "@/store/customerStore";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

export default function RegistrarAbonoPage() {
  const params = useParams();
  const router = useRouter();
  const id = routeId(params.id);
  const [customer, setCustomer] = useState<RemoteCustomer | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
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
    return abonoRemainingHelper(customer.debt, amount);
  }, [customer, amount]);

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
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/clientes" className="text-sm text-ink-muted">
          ← Clientes
        </Link>
        <p className="text-sm text-ink-muted">No encontramos ese cliente.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href={`/clientes/${customer.id}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Registrar abono</h1>
      </header>

      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Cliente
        </p>
        <p className="mt-1 text-base font-semibold">{customer.name}</p>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">
          Saldo
        </p>
        <p className="mt-1 text-xl font-semibold text-accent">
          {formatCop(customer.debt)}
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="abono">
          Abono
        </label>
        <Input
          id="abono"
          inputMode="numeric"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2"
          placeholder="0"
        />

        <p className="mt-4 text-sm font-semibold">¿Cómo recibes?</p>
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

        {helper && (
          <p className="mt-3 text-sm text-ink-muted">{helper}</p>
        )}

        {pendingSync && (
          <p className="mt-3 text-sm text-ink-muted">
            Este cliente aún se está sincronizando. Podrás registrar el abono
            en cuanto termine la sincronización.
          </p>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit || busy || pendingSync}
            onClick={() => void confirm()}
            className="w-full"
          >
            Confirmar abono
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
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      className={`w-full px-2 ${
        active
          ? "border-primary bg-primary text-ink hover:opacity-[0.92]"
          : "text-ink-muted"
      }`}
    >
      {label}
    </Button>
  );
}
