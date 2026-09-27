"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useState } from "react";
import { CUSTOMER_ERRORS } from "@/domain/abono";
import { useCustomers } from "@/store/customerStore";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export default function AgregarClientePage() {
  const router = useRouter();
  const { createCustomer } = useCustomers();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function onSave() {
    if (busy) return;
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError(CUSTOMER_ERRORS.emptyName);
      return;
    }
    setBusy(true);
    try {
      await createCustomer(trimmed);
      setToast("Cliente guardado");
      setTimeout(() => {
        navigateOfflineAware(router, "/clientes");
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : CUSTOMER_ERRORS.emptyName);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/clientes"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Agregar cliente</h1>
      </header>

      <Card>
        <label className="text-sm font-medium" htmlFor="nombre">
          Nombre
        </label>
        <Input
          id="nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2"
          autoComplete="name"
          autoFocus
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => void onSave()}
            className="w-full"
          >
            Guardar cliente
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
