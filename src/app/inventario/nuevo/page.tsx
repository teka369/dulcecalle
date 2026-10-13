"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { useInventory } from "@/store/inventoryStore";
import { ProductImageManager } from "@/components/product/ProductImageManager";
import { getPwaApi } from "@/data/pwa/api";
import type { RemoteProductImage } from "@/data/http/mappers";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { AmountField } from "@/components/ui/AmountField";
import { StateBlock } from "@/components/ui/StateBlock";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";
import { QtyStepper } from "@/components/inventory/QtyStepper";

export default function AgregarProductoPage() {
  const router = useRouter();
  const { createProduct } = useInventory();
  const [name, setName] = useState("");
  const [priceRaw, setPriceRaw] = useState("");
  const [stockRaw, setStockRaw] = useState("");
  const [costRaw, setCostRaw] = useState("");
  const [gifted, setGifted] = useState(false);
  // TICKET-A: venta (standard sellable) · insumo (standard, no se vende) · combo.
  const [tipo, setTipo] = useState<"venta" | "insumo" | "combo">("venta");
  const sellable = tipo === "venta";
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [createdImages, setCreatedImages] = useState<RemoteProductImage[]>([]);

  async function reloadCreatedImages(id: string) {
    try {
      setCreatedImages(await getPwaApi().products.listImages(id));
    } catch {
      /* offline: pending list inside the manager still shows */
    }
  }

  async function onSave() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await createProduct({
        name,
        priceRaw: priceRaw || "0",
        stockRaw: stockRaw || "0",
        avgCostRaw: gifted ? "0" : costRaw || "0",
        gifted,
        sellable,
        kind: tipo === "combo" ? "combo" : "standard",
      });
      setToast(
        result.mode === "offline"
          ? "Producto guardado sin conexión"
          : "Producto guardado",
      );
      setCreatedId(result.id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : INVENTORY_ERRORS.emptyProductName,
      );
      setBusy(false);
    }
  }

  const label = "text-xs font-semibold uppercase tracking-wide text-ink-muted";
  const group = "flex flex-col gap-4 rounded-[var(--r-lg)] border border-border bg-surface p-3";

  if (createdId) {
    return (
      <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
        <HeroBlock size="compact" title="Fotos del producto" subtitle={toast ?? undefined} />
        <Sheet>
          <p className="text-sm text-ink-muted">Agrega fotos ahora o termina y hazlo después desde el producto.</p>
          <ProductImageManager
            productId={createdId}
            images={createdImages}
            onChanged={() => void reloadCreatedImages(createdId)}
          />
        </Sheet>
        <ActionBar primary={{ label: "Terminar", onClick: () => router.push(`/inventario/${createdId}`) }} />
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock size="compact" back={{ href: "/inventario", label: "Volver a Inventario" }} title="Agregar producto" />

      <Sheet>
        <section className="flex flex-col gap-2">
          <SectionHead title="Básico" />
          <div className={group}>
            <div>
              <label className={label} htmlFor="nombre">
                Nombre
              </label>
              <Input id="nombre" value={name} onChange={(e) => setName(e.target.value)} className="mt-2" autoFocus />
            </div>
            <AmountField label="Precio venta" value={priceRaw} onChange={setPriceRaw} />
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <SectionHead title="Stock" />
          <div className={group}>
            <QtyStepper label="Stock inicial" value={stockRaw} onChange={setStockRaw} />
            {gifted ? (
              <p className="text-sm text-ink-muted">Costo $ 0 (me lo regalaron / no sé el costo).</p>
            ) : (
              <AmountField label="Costo" value={costRaw} onChange={setCostRaw} />
            )}
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={gifted}
                onChange={(e) => setGifted(e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 rounded border-border"
              />
              <span>
                <span className="font-medium">Me lo regalaron / no sé el costo</span>
                <span className="mt-1 block text-ink-muted">
                  {gifted
                    ? "Entran a $0. No descuenta caja. La ganancia de estas unidades será casi todo el precio. Cuando compres más, el costo se llena en Surtir."
                    : "Si ya tienes unidades, pon lo que te costó cada una. Sin stock puede ir en 0 y se llena al surtir."}
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <SectionHead title="Tipo" />
          <div className={group} role="radiogroup" aria-label="Tipo de producto">
            {(
              [
                ["venta", "Para vender", "Aparece en ventas y en el catálogo de clientes."],
                ["insumo", "Insumo", "No se vende. Se compra con proveedor."],
                [
                  "combo",
                  "Combo para preparar",
                  "Lote que se transforma con Preparar. Nunca se vende. El tipo no se puede cambiar cuando ya tiene stock.",
                ],
              ] as const
            ).map(([value, title, hint]) => (
              <label key={value} className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="tipo"
                  value={value}
                  checked={tipo === value}
                  onChange={() => setTipo(value)}
                  className="mt-1 h-5 w-5 shrink-0 border-border"
                />
                <span>
                  <span className="font-medium">{title}</span>
                  <span className="mt-1 block text-ink-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <SectionHead title="Fotos" />
          <p className="text-sm text-ink-muted">Fotos del producto: las agregas después de guardar.</p>
        </section>

        {error ? <StateBlock kind="error" title={error} /> : null}
      </Sheet>

      <ActionBar primary={{ label: "Guardar producto", onClick: () => void onSave(), busy }} />
      <ActionToast text={toast} />
    </div>
  );
}
