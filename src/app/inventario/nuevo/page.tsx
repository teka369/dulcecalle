"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { useInventory } from "@/store/inventoryStore";

export default function AgregarProductoPage() {
  const router = useRouter();
  const { createProduct } = useInventory();
  const [name, setName] = useState("");
  const [priceRaw, setPriceRaw] = useState("");
  const [stockRaw, setStockRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function onSave() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const id = await createProduct({
        name,
        priceRaw: priceRaw || "0",
        stockRaw: stockRaw || "0",
      });
      setToast("Producto guardado");
      setTimeout(() => {
        router.push(`/inventario/${id}`);
      }, 700);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : INVENTORY_ERRORS.emptyProductName,
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/inventario"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Agregar producto</h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
        <label className="text-sm font-medium" htmlFor="nombre">
          Nombre
        </label>
        <input
          id="nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          autoFocus
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="precio">
          Precio venta
        </label>
        <input
          id="precio"
          inputMode="numeric"
          value={priceRaw}
          onChange={(e) => setPriceRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          placeholder="0"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="stock">
          Stock inicial
        </label>
        <input
          id="stock"
          inputMode="numeric"
          value={stockRaw}
          onChange={(e) => setStockRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          placeholder="0"
        />

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave()}
            className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            Agregar producto
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
