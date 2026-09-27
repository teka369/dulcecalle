"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { useInventory } from "@/store/inventoryStore";
import { ProductImageManager } from "@/components/product/ProductImageManager";
import { getPwaApi } from "@/data/pwa/api";
import type { RemoteProductImage } from "@/data/http/mappers";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export default function AgregarProductoPage() {
  const router = useRouter();
  const { createProduct } = useInventory();
  const [name, setName] = useState("");
  const [priceRaw, setPriceRaw] = useState("");
  const [stockRaw, setStockRaw] = useState("");
  const [costRaw, setCostRaw] = useState("");
  const [gifted, setGifted] = useState(false);
  const [sellable, setSellable] = useState(true);
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

  if (createdId) {
    return (
      <div className="flex flex-col gap-4 pb-28">
        <header className="flex items-center gap-2">
          <h1 className="text-[22px] font-semibold">Fotos del producto</h1>
        </header>
        <p className="text-sm text-ink-muted">
          {toast} Agrega fotos ahora o termina y hazlo después desde el
          producto.
        </p>
        <ProductImageManager
          productId={createdId}
          images={createdImages}
          onChanged={() => void reloadCreatedImages(createdId)}
        />
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-lg">
            <Button
              type="button"
              variant="primary"
              onClick={() => router.push(`/inventario/${createdId}`)}
              className="w-full"
            >
              Terminar
            </Button>
          </div>
        </div>
      </div>
    );
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
        <h1 className="text-[22px] font-semibold">Agregar producto</h1>
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

        <label className="mt-4 block text-sm font-medium" htmlFor="precio">
          Precio venta
        </label>
        <Input
          id="precio"
          inputMode="numeric"
          value={priceRaw}
          onChange={(e) => setPriceRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2"
          placeholder="0"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="stock">
          Stock inicial
        </label>
        <Input
          id="stock"
          inputMode="numeric"
          value={stockRaw}
          onChange={(e) => setStockRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2"
          placeholder="0"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="costo">
          Costo
        </label>
        <Input
          id="costo"
          inputMode="numeric"
          value={gifted ? "0" : costRaw}
          onChange={(e) => setCostRaw(e.target.value.replace(/\D/g, ""))}
          disabled={gifted}
          className="mt-2 disabled:bg-surface-2 disabled:text-ink-muted"
          placeholder="0"
        />
        <label className="mt-3 flex min-h-11 items-start gap-3 text-sm">
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

        <label className="mt-3 flex min-h-11 items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={!sellable}
            onChange={(e) => setSellable(!e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 rounded border-border"
          />
          <span>
            <span className="font-medium">Es insumo o combo para preparar</span>
            <span className="mt-1 block text-ink-muted">
              No aparece para vender ni en el catálogo de clientes. Se compra
              con proveedor y se transforma con Preparar.
            </span>
          </span>
        </label>

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
            Agregar producto
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
