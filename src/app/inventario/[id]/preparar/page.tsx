"use client";

import { useRouter } from "next/navigation";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useEffect, useState } from "react";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { formatCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import type { RemoteProduct } from "@/data/http/mappers";
import { primaryImageUrl } from "@/data/media/urls";
import { useEntityId } from "@/components/shell/entity-route";
import { inventoryStore, useInventory } from "@/store/inventoryStore";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";

export default function PrepararPage() {
  const router = useRouter();
  const sourceId = useEntityId();
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
    return <p className="text-sm text-ink-muted">No encontramos ese producto.</p>;
  }

  async function onPrepare() {
    if (busy) return;
    if (!sourceId) return;
    setError(null);
    if (source) {
      const digits = qtyRaw.replace(/\D/g, "");
      const costDigits = costRaw.replace(/\D/g, "");
      const qty = digits ? Number.parseInt(digits, 10) : NaN;
      const unitCost = costDigits ? Number.parseInt(costDigits, 10) : null;
      if (
        Number.isInteger(qty) &&
        unitCost !== null &&
        unitCost * (qty as number) > source.avgCost
      ) {
        setError(
          `Este costo supera el valor restante del lote (${formatCop(source.avgCost)}).`,
        );
        return;
      }
    }
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
        <p className="text-sm text-ink-muted">
          {qtyRaw} uds de {target?.name ?? "producto"} ya son stock vendible.
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => navigateOfflineAware(router, `/inventario/${done}`)}
          className="w-full"
        >
          Ver producto
        </Button>
        <OfflineLink
          href={`/inventario/${sourceId}`}
          className="flex min-h-11 w-full items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold"
        >
          Volver al combo
        </OfflineLink>
      </div>
    );
  }

  const targets = products.filter(
    (p) => p.id !== sourceId && !p.archivedAt && p.sellable !== false,
  );

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <OfflineLink
          href={`/inventario/${sourceId}`}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          ariaLabel="Volver"
        >
          ←
        </OfflineLink>
        <h1 className="text-[22px] font-semibold">Preparar</h1>
      </header>

      {source && (
        <Card className="flex items-start gap-3">
          <ProductThumbnail
            secureUrl={primaryImageUrl(source.images)}
            alt={source.name}
            size="md"
          />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Proviene de
            </p>
            <p className="mt-1 font-semibold">{source.name}</p>
            <p className="mt-1 text-sm text-ink-muted">
              Lotes disponibles: {source.stock} · Valor restante:{" "}
              {formatCop(source.avgCost)}
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              Costo máximo asignable en total: {formatCop(source.avgCost)}
            </p>
          </div>
        </Card>
      )}

      <Card>
        <label className="text-sm font-medium" htmlFor="preparar-producto">
          ¿Qué vas a preparar?
        </label>
        <select
          id="preparar-producto"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="mt-2 h-11 min-h-11 w-full rounded-[var(--r-md)] border border-border bg-surface px-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
        <Input
          id="preparar-cantidad"
          inputMode="numeric"
          value={qtyRaw}
          onChange={(e) => setQtyRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2"
          placeholder="10"
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="preparar-costo">
          Costo por unidad (opcional)
        </label>
        <Input
          id="preparar-costo"
          inputMode="numeric"
          value={costRaw}
          onChange={(e) => setCostRaw(e.target.value.replace(/\D/g, ""))}
          className="mt-2"
          placeholder="0"
        />
        <p className="mt-1 text-xs text-ink-muted">
          {INVENTORY_ERRORS.pendingCostHint} El combo conserva su valor; aquí
          solo defines el costo de estas unidades.
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="preparar-nota">
          Nota (opcional)
        </label>
        <Input
          id="preparar-nota"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-2"
          placeholder="Tanda de la mañana"
          maxLength={160}
        />

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button
            type="button"
            variant="primary"
            disabled={busy || !targetId}
            onClick={() => void onPrepare()}
            className="w-full"
          >
            Preparar
          </Button>
        </div>
      </div>
    </div>
  );
}
