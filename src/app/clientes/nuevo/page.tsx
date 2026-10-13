"use client";

import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useState } from "react";
import { CUSTOMER_ERRORS } from "@/domain/abono";
import { useCustomers } from "@/store/customerStore";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";
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
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock size="compact" back={{ href: "/clientes", label: "Volver a Clientes" }} title="Agregar cliente" />
      <Sheet>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-muted" htmlFor="nombre">
            Nombre
          </label>
          <Input
            id="nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 h-14 text-lg"
            autoComplete="name"
            aria-invalid={error ? true : undefined}
            autoFocus
          />
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
          <p className="mt-2 text-sm text-ink-muted">El código lo asigna el sistema. El teléfono se edita en el detalle.</p>
        </div>
      </Sheet>
      <ActionBar primary={{ label: "Guardar cliente", onClick: () => void onSave(), busy }} />
      <ActionToast text={toast} />
    </div>
  );
}
