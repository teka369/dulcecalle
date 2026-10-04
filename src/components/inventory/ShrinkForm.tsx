"use client";

import { useRouter } from "next/navigation";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RemoteProduct } from "@/data/http/mappers";
import {
  validateMotivo,
  validateShrinkQty,
  type ShrinkReason,
} from "@/domain/inventory";
import { newRequestId } from "@/domain/requestId";
import { EntityBackLink, useEntityId } from "@/components/shell/entity-route";
import { inventoryStore } from "@/store/inventoryStore";
import { primaryImageUrl } from "@/data/media/urls";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

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
  const router = useRouter();
  const id = useEntityId();
  const [product, setProduct] = useState<RemoteProduct | null>(null);
  const [qtyRaw, setQtyRaw] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
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
        productId: product.id,
        qtyRaw,
        reason,
        note: showNote ? note : undefined,
        motivoRaw: requireMotivo ? note : undefined,
        requestId: requestIdRef.current,
      });
      setToast(toastText);
      setTimeout(() => {
        navigateOfflineAware(router, `/inventario/${product.id}`);
      }, 700);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col gap-4">
        <EntityBackLink href="/inventario" className="text-sm text-ink-muted">
          ← Inventario
        </EntityBackLink>
        <p className="text-sm text-ink-muted">No encontramos ese producto.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <EntityBackLink
          href={`/inventario/${product.id}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </EntityBackLink>
        <h1 className="text-[22px] font-semibold">{title}</h1>
      </header>

      <Card>
        <div className="flex items-start gap-3">
          <ProductThumbnail
            secureUrl={primaryImageUrl(product.images)}
            alt={product.name}
            size="md"
          />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Producto
            </p>
            <p className="mt-1 font-semibold">{product.name}</p>
            <p className="mt-1 text-sm text-ink-muted">Stock {product.stock}</p>
          </div>
        </div>

        <label className="mt-4 block text-sm font-medium" htmlFor="cantidad">
          Cantidad
        </label>
        <Input
          id="cantidad"
          inputMode="numeric"
          value={qtyRaw}
          onChange={(e) => setQtyRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2"
          placeholder="0"
        />

        {(showNote || requireMotivo) && (
          <>
            <label className="mt-4 block text-sm font-medium" htmlFor="nota">
              {requireMotivo ? "Motivo" : "Nota"}
            </label>
            <Input
              id="nota"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-2"
            />
          </>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            type="button"
            variant="primary"
            disabled={!valid || busy}
            onClick={() => void confirm()}
            className="w-full"
          >
            {cta}
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
