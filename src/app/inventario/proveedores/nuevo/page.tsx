"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useState } from "react";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { useInventory } from "@/store/inventoryStore";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export default function AgregarProveedorPage() {
  const router = useRouter();
  const { createSupplier } = useInventory();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function onSave() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await createSupplier({ name, phone, notes });
      setToast(result.mode === "offline" ? "Proveedor guardado sin conexión" : "Proveedor guardado");
      setTimeout(() => {
        navigateOfflineAware(router, result.mode === "offline" ? "/inventario" : `/inventario/proveedores/${result.id}`);
      }, 700);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : INVENTORY_ERRORS.emptySupplierName,
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/inventario"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Agregar proveedor</h1>
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
          autoFocus
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="tel">
          Teléfono
        </label>
        <Input
          id="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="mt-2"
          inputMode="tel"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="notas">
          Notas
        </label>
        <Input
          id="notas"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-2"
        />

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
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
            Guardar proveedor
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
