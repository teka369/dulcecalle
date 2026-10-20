"use client";

import { useOfflineBand } from "@/components/shell/use-online";
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
import { useEntityId } from "@/components/shell/entity-route";
import { inventoryStore } from "@/store/inventoryStore";
import { primaryImageUrl } from "@/data/media/urls";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { Row } from "@/components/ui/Row";
import { RowGroup } from "@/components/ui/RowGroup";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { ActionToast } from "@/components/ui/ActionToast";
import { QtyStepper } from "./QtyStepper";
import { stockAfter, units } from "./inventory";

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
  const offlineBand = useOfflineBand();
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
      <div className="flex flex-col gap-4">
        <SkeletonHero title={title} />
        <SkeletonRows rows={3} />
      </div>
    );
  }

  if (!product) {
    return (
      <HeroBlock offline={offlineBand} size="compact" back={{ href: "/inventario", label: "Volver a Inventario", entity: true }} title={title}>
        <StateBlock onHero kind="empty" title="No encontramos ese producto." />
      </HeroBlock>
    );
  }

  const after = stockAfter(product.stock, qtyRaw, -1);

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock offline={offlineBand}
        size="compact"
        back={{ href: `/inventario/${product.id}`, label: "Volver al producto", entity: true }}
        title={title}
      >
        <div className="mt-3 flex items-center gap-3">
          <ProductThumbnail secureUrl={primaryImageUrl(product.images)} alt={product.name} size="sm" decorative />
          <p className="min-w-0 text-sm text-on-hero-muted">
            <span className="font-semibold text-on-hero">{product.name}</span> · Stock {units(product.stock)}
          </p>
        </div>
      </HeroBlock>

      <Sheet>
        <QtyStepper label="Cantidad" value={qtyRaw} onChange={setQtyRaw} max={product.stock} />

        {(showNote || requireMotivo) && (
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-ink-muted" htmlFor="nota">
              {requireMotivo ? "Motivo" : "Nota"}
            </label>
            <Input id="nota" value={note} onChange={(e) => setNote(e.target.value)} className="mt-2" />
          </div>
        )}

        {after != null ? (
          <RowGroup label="Resultado">
            <Row title={`Quedará ${units(after)}`} />
          </RowGroup>
        ) : null}

        {error ? <StateBlock kind="error" title={error} /> : null}
      </Sheet>

      <ActionBar primary={{ label: cta, onClick: () => void confirm(), disabled: !valid, busy }} />
      <ActionToast text={toast} />
    </div>
  );
}
