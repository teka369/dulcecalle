"use client";

import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useState } from "react";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { useInventory } from "@/store/inventoryStore";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { StateBlock } from "@/components/ui/StateBlock";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";

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

  const label = "text-xs font-semibold uppercase tracking-wide text-ink-muted";
  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock size="compact" back={{ href: "/inventario", label: "Volver a Inventario" }} title="Agregar proveedor" />
      <Sheet>
        <div className="flex flex-col gap-4 rounded-[var(--r-lg)] border border-border bg-surface p-3">
          <div>
            <label className={label} htmlFor="nombre">
              Nombre
            </label>
            <Input id="nombre" value={name} onChange={(e) => setName(e.target.value)} className="mt-2" autoFocus />
          </div>
          <div>
            <label className={label} htmlFor="tel">
              Teléfono
            </label>
            <Input id="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-2" inputMode="tel" />
          </div>
          <div>
            <label className={label} htmlFor="notas">
              Notas
            </label>
            <Input id="notas" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-2" />
          </div>
        </div>
        {error ? <StateBlock kind="error" title={error} /> : null}
      </Sheet>
      <ActionBar primary={{ label: "Guardar proveedor", onClick: () => void onSave(), busy }} />
      <ActionToast text={toast} />
    </div>
  );
}
