"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  abonoRemainingHelper,
  parseAbonoAmount,
  validateAbono,
} from "@/domain/abono";
import { formatCop } from "@/domain/money";
import type { Customer, PayMethod } from "@/domain/types";
import { customerStore } from "@/store/customerStore";

export default function RegistrarAbonoPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [amountRaw, setAmountRaw] = useState("");
  const [method, setMethod] = useState<PayMethod>("Efectivo");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
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
        requestIdRef.current =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `abono-${customer.id}-${amountRaw}-${Date.now()}`;
      }
      await customerStore.recordAbono({
        customerId: customer.id!,
        amountRaw,
        method,
        requestId: requestIdRef.current,
      });
      setToast("Abono registrado");
      setTimeout(() => {
        router.push(`/clientes/${customer.id}`);
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al registrar abono");
      setBusy(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!customer) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/clientes" className="text-sm text-ink/70">
          ← Clientes
        </Link>
        <p className="text-sm text-ink/60">No encontramos ese cliente.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href={`/clientes/${customer.id}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Registrar abono</h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
          Cliente
        </p>
        <p className="mt-1 text-base font-semibold">{customer.name}</p>

        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink/50">
          Saldo
        </p>
        <p className="mt-1 text-xl font-semibold text-accent">
          {formatCop(customer.debt)}
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="abono">
          Abono
        </label>
        <input
          id="abono"
          inputMode="numeric"
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
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
          <p className="mt-3 text-sm text-ink/70">{helper}</p>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={() => void confirm()}
            className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            Confirmar abono
          </button>
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
      className={`min-h-11 rounded-[14px] border px-2 text-sm font-semibold ${
        active
          ? "border-primary bg-primary text-ink"
          : "border-ink/10 bg-white text-ink/70"
      }`}
    >
      {label}
    </button>
  );
}
