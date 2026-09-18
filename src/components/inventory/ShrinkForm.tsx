"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/domain/types";
import {
  validateMotivo,
  validateShrinkQty,
  type ShrinkReason,
} from "@/domain/inventory";
import { newRequestId } from "@/domain/requestId";
import { inventoryStore } from "@/store/inventoryStore";

export function ShrinkForm({
  title,
  reason,
  cta,
  toast: toastText,
  showNote = false,
  requireMotivo = false,
}: {
  title: string;
  reason: ShrinkReason;
  cta: string;
  toast: string;
  showNote?: boolean;
  requireMotivo?: boolean;
}) {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [product, setProduct] = useState<Product | null>(null);
  const [qtyRaw, setQtyRaw] = useState("");
  const [note, setNote] = useState("");
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
    const p = await inventoryStore.getProduct(id);
    setProduct(p ?? null);
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const valid = useMemo(() => {
    if (!product) return false;
    const q = validateShrinkQty(qtyRaw, product.stock);
    if ("error" in q) return false;
    if (requireMotivo && validateMotivo(note) != null) return false;
    return true;
  }, [product, qtyRaw, note, requireMotivo]);

  async function confirm() {
    if (!product || busy) return;
    setError(null);
    const q = validateShrinkQty(qtyRaw, product.stock);
    if ("error" in q) {
      setError(q.error);
      return;
    }
    if (requireMotivo) {
      const m = validateMotivo(note);
      if (m) {
        setError(m);
        return;
      }
    }
    setBusy(true);
    try {
      if (!requestIdRef.current) requestIdRef.current = newRequestId("shrink");
      await inventoryStore.applyShrink({
        productId: product.id!,
        qtyRaw,
        reason,
        note: showNote ? note : undefined,
        motivoRaw: requireMotivo ? note : undefined,
        requestId: requestIdRef.current,
      });
      setToast(toastText);
      setTimeout(() => {
        router.push(`/inventario/${product.id}`);
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!product) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/inventario" className="text-sm text-ink/70">
          ← Inventario
        </Link>
        <p className="text-sm text-ink/60">No encontramos ese producto.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href={`/inventario/${product.id}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">{title}</h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
          Producto
        </p>
        <p className="mt-1 font-semibold">{product.name}</p>
        <p className="mt-1 text-sm text-ink/60">Stock {product.stock}</p>

        <label className="mt-4 block text-sm font-medium" htmlFor="cantidad">
          Cantidad
        </label>
        <input
          id="cantidad"
          inputMode="numeric"
          value={qtyRaw}
          onChange={(e) => setQtyRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          placeholder="0"
        />

        {(showNote || requireMotivo) && (
          <>
            <label className="mt-4 block text-sm font-medium" htmlFor="nota">
              {requireMotivo ? "Motivo" : "Nota"}
            </label>
            <input
              id="nota"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
            />
          </>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void confirm()}
            className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            {cta}
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
