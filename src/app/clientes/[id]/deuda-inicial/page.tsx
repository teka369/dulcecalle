"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INITIAL_DEBT_TOAST,
  parseInitialDebtAmount,
  validateInitialDebtAmount,
} from "@/domain/initialDebt";
import { formatCop } from "@/domain/money";
import type { RemoteCustomer } from "@/data/http/mappers";
import { routeId } from "@/data/pwa/ids";
import { customerStore } from "@/store/customerStore";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

export default function AgregarDeudaAnteriorPage() {
  const params = useParams();
  const router = useRouter();
  const id = routeId(params.id);
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
      await customerStore.recordInitialDebt({
        customerId: customer.id,
        amountRaw,
        requestId: requestIdRef.current,
      });
      setToast(INITIAL_DEBT_TOAST);
      setTimeout(() => {
        router.push(`/clientes/${customer.id}`);
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
        <h1 className="text-[22px] font-semibold">Agregar deuda anterior</h1>
      </header>

      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Cliente
        </p>
        <p className="mt-1 text-base font-semibold">{customer.name}</p>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">
          Saldo ahora
        </p>
        <p className="mt-1 text-xl font-semibold">
          {formatCop(customer.debt)}
        </p>

        <p className="mt-4 text-sm text-ink-muted">
          Lo que ya debía antes de usar DulceCalle. No es una venta: no mueve
          caja ni inventario.
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="deuda">
          Cuánto debía
        </label>
        <Input
          id="deuda"
          inputMode="numeric"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2"
          placeholder="0"
          autoFocus
        />

        {preview != null && (
          <p className="mt-3 text-sm text-ink-muted">
            Quedará debiendo {formatCop(preview)}
          </p>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            type="button"
            variant="primary"
            disabled={!canSubmit || busy}
            onClick={() => void confirm()}
            className="w-full"
          >
            Guardar deuda anterior
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
