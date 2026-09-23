"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { formatCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import type { RemoteProduct } from "@/data/http/mappers";
import { primaryImageUrl } from "@/data/media/urls";
import { routeId } from "@/data/pwa/ids";
import { inventoryStore, useInventory } from "@/store/inventoryStore";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";

export default function PrepararPage() {
  const params = useParams();
  const router = useRouter();
  const sourceId = routeId(params.id);
  const { products } = useInventory();
  const [source, setSource] = useState<RemoteProduct | null>(null);
  const [targetId, setTargetId] = useState("");
  const [qtyRaw, setQtyRaw] = useState("");
  const [costRaw, setCostRaw] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceId) return;
    setSource(products.find((p) => p.id === sourceId) ?? null);
  }, [products, sourceId]);

  if (!sourceId) {
    return <p className="text-sm text-ink/60">No encontramos ese producto.</p>;
  }

  async function onPrepare() {
    if (busy) return;
    if (!sourceId) return;
    setError(null);
    setBusy(true);
    try {
      const id = await inventoryStore.preparar({
        sourceId,
        targetId,
        qtyRaw,
        unitCostRaw: costRaw,
        note: note.trim() || undefined,
        requestId: newRequestId("preparacion"),
      });
      void id;
      setDone(targetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : INVENTORY_ERRORS.emptyQty);
      setBusy(false);
    }
  }

  if (done) {
    const target = products.find((p) => p.id === done);
    return (
      <div className="flex flex-col gap-4 pb-28">
        <h1 className="text-[22px] font-semibold">Preparación lista</h1>
        <p className="text-sm text-ink/60">
          {qtyRaw} uds de {target?.name ?? "producto"} ya son stock vendible.
        </p>
        <button
          type="button"
          onClick={() => router.push(`/inventario/${done}`)}
          className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white"
        >
          Ver producto
        </button>
        <Link
          href={`/inventario/${sourceId}`}
          className="flex min-h-11 w-full items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold"
        >
          Volver al combo
        </Link>
      </div>
    );
  }

  const targets = products.filter(
    (p) => p.id !== sourceId && !p.archivedAt && p.sellable !== false,
  );

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href={`/inventario/${sourceId}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Preparar</h1>
      </header>

      {source && (
        <section className="flex items-start gap-3 rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <ProductThumbnail
            secureUrl={primaryImageUrl(source.images)}
            alt={source.name}
            size="md"
          />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
              Proviene de
            </p>
            <p className="mt-1 font-semibold">{source.name}</p>
            <p className="mt-1 text-sm text-ink/60">
              Lotes disponibles: {source.stock} · Valor restante:{" "}
              {formatCop(source.avgCost)}
            </p>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <label className="text-sm font-medium" htmlFor="preparar-producto">
          ¿Qué vas a preparar?
        </label>
        <select
          id="preparar-producto"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 bg-bg px-3 text-base outline-none focus:border-primary"
        >
          <option value="">Elige el producto…</option>
          {targets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} (stock {p.stock})
            </option>
          ))}
        </select>

        <label className="mt-4 block text-sm font-medium" htmlFor="preparar-cantidad">
          ¿Cuántas hiciste?
        </label>
        <input
          id="preparar-cantidad"
          inputMode="numeric"
          value={qtyRaw}
          onChange={(e) => setQtyRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          placeholder="10"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="preparar-costo">
          Costo por unidad (opcional)
        </label>
        <input
          id="preparar-costo"
          inputMode="numeric"
          value={costRaw}
          onChange={(e) => setCostRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          placeholder="0"
        />
        <p className="mt-1 text-xs text-ink/55">
          {INVENTORY_ERRORS.pendingCostHint} El combo conserva su valor; aquí
          solo defines el costo de estas unidades.
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="preparar-nota">
          Nota (opcional)
        </label>
        <input
          id="preparar-nota"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          placeholder="Tanda de la mañana"
          maxLength={160}
        />

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            disabled={busy || !targetId}
            onClick={() => void onPrepare()}
            className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            Preparar
          </button>
        </div>
      </div>
    </div>
  );
}
