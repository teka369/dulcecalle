"use client";

import { useOfflineBand } from "@/components/shell/use-online";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { AmountField, amountInputInvalid } from "@/components/ui/AmountField";
import { StateBlock } from "@/components/ui/StateBlock";
import { ListErrorState } from "@/components/ui/ListErrorState";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";
import { QtyStepper } from "@/components/inventory/QtyStepper";
import { units } from "@/components/inventory/inventory";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { useEffect, useState } from "react";
import { INVENTORY_ERRORS } from "@/domain/inventory";
import { formatCop } from "@/domain/money";
import { newRequestId } from "@/domain/requestId";
import type { RemoteProduct } from "@/data/http/mappers";
import { primaryImageUrl } from "@/data/media/urls";
import { EntityBackLink, useEntityId } from "@/components/shell/entity-route";
import { inventoryStore, useInventory } from "@/store/inventoryStore";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";

export default function PrepararPage() {
  const offlineBand = useOfflineBand();
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

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRev, setLoadRev] = useState(0);

  // Direct entry: products may not be loaded yet. Read the source itself so the
  // header (insumo · stock · costo) and the sellable guard don't depend on the list.
  useEffect(() => {
    if (!sourceId) return;
    let alive = true;
    setLoadError(null);
    // Only a real 404 comes back as undefined («No encontramos»); other errors → Reintentar.
    void inventoryStore
      .getProduct(sourceId)
      .then((p) => {
        if (alive) setSource(p ?? null);
      })
      .catch((e: unknown) => {
        if (alive) setLoadError(e instanceof Error ? e.message : "");
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    if (inventoryStore.getSnapshot().products.length === 0) void inventoryStore.refreshAll().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sourceId, loadRev]);

  // Preparar only exists for insumo/combo (sellable === false). Sellable → back to the product.
  const sellable = source != null && source.sellable !== false;
  useEffect(() => {
    if (sellable && sourceId) router.replace(`/inventario/${sourceId}`);
  }, [sellable, sourceId, router]);

  if (!sourceId) {
    return (
      <HeroBlock offline={offlineBand} size="compact" back={{ href: "/inventario", label: "Volver a Inventario", entity: true }} title="Preparar">
        <StateBlock onHero kind="empty" title="No encontramos ese producto." />
      </HeroBlock>
    );
  }

  async function onPrepare() {
    if (amountInputInvalid()) return; // a rejected amount is on screen: never send
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

  if (sellable) {
    return (
      <HeroBlock offline={offlineBand} size="compact" back={{ href: `/inventario/${sourceId}`, label: "Volver al producto", entity: true }} title="Preparar">
        <StateBlock
          onHero
          kind="empty"
          title="Este producto se vende directo."
          body="Preparar solo aplica a insumos o combos. Te llevamos al producto."
        />
      </HeroBlock>
    );
  }

  if (loaded && loadError !== null) {
    return (
      <div className="flex flex-col">
        <HeroBlock offline={offlineBand} size="compact" back={{ href: "/inventario", label: "Volver a Inventario", entity: true }} title="Preparar" />
        <Sheet>
          <ListErrorState
            message={loadError}
            online={typeof navigator === "undefined" || navigator.onLine}
            onRetry={() => {
              setLoaded(false);
              setLoadRev((n) => n + 1);
            }}
          />
        </Sheet>
      </div>
    );
  }

  if (loaded && !source) {
    return (
      <HeroBlock offline={offlineBand} size="compact" back={{ href: "/inventario", label: "Volver a Inventario", entity: true }} title="Preparar">
        <StateBlock onHero kind="empty" title="No encontramos ese producto." />
      </HeroBlock>
    );
  }

  if (done) {
    const target = products.find((p) => p.id === done);
    return (
      <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
        <HeroBlock offline={offlineBand} size="compact" back={{ href: `/inventario/${sourceId}`, label: "Volver al combo", entity: true }} title="Preparación lista">
          <p className="mt-2 text-sm text-on-hero-muted">
            {qtyRaw} uds de {target?.name ?? "producto"} ya son stock vendible.
          </p>
        </HeroBlock>
        <Sheet>
          <Button type="button" variant="primary" onClick={() => navigateOfflineAware(router, `/inventario/${done}`)} className="w-full">
            Ver producto
          </Button>
          <EntityBackLink
            href={`/inventario/${sourceId}`}
            className="flex min-h-11 w-full items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold"
          >
            Volver al combo
          </EntityBackLink>
        </Sheet>
      </div>
    );
  }

  const targets = products.filter((p) => p.id !== sourceId && !p.archivedAt && p.sellable !== false);
  const label = "text-xs font-semibold uppercase tracking-wide text-ink-muted";

  return (
    <div className="flex flex-col pb-[calc(var(--actionbar-h)+var(--nav-h)+1.5rem)]">
      <HeroBlock offline={offlineBand} size="compact" back={{ href: `/inventario/${sourceId}`, label: "Volver al combo", entity: true }} title="Preparar">
        {source ? (
          <div className="mt-3 flex items-center gap-3">
            <ProductThumbnail secureUrl={primaryImageUrl(source.images)} alt={source.name} size="sm" decorative />
            <p className="min-w-0 text-sm text-on-hero-muted">
              Insumo: <span className="font-semibold text-on-hero">{source.name}</span> · Stock {units(source.stock)} ·
              Costo prom. {formatCop(source.avgCost)}
            </p>
          </div>
        ) : null}
      </HeroBlock>

      <Sheet>
        <div>
          <label className={label} htmlFor="preparar-producto">
            Destino · ¿Qué vas a preparar?
          </label>
          <select
            id="preparar-producto"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className="mt-2 h-14 w-full rounded-[var(--r-md)] border border-border bg-surface px-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-[var(--cta)]"
          >
            <option value="">Elige el producto…</option>
            {targets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (stock {p.stock})
              </option>
            ))}
          </select>
        </div>

        <QtyStepper label="¿Cuántas hiciste?" value={qtyRaw} onChange={setQtyRaw} />

        <AmountField
          label="Costo por unidad (opcional)"
          value={costRaw}
          onChange={setCostRaw}
          hint={`${INVENTORY_ERRORS.pendingCostHint} El combo conserva su valor; aquí solo defines el costo de estas unidades.${
            source ? ` Máximo asignable en total: ${formatCop(source.avgCost)}.` : ""
          }`}
        />

        <div>
          <label className={label} htmlFor="preparar-nota">
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
        </div>

        {error ? <StateBlock kind="error" title={error} /> : null}
      </Sheet>

      <ActionBar aboveNav primary={{ label: "Preparar", onClick: () => void onPrepare(), disabled: !targetId, busy }} />
    </div>
  );
}
