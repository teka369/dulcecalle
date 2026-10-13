"use client";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { SegmentedMetrics } from "@/components/ui/SegmentedMetrics";
import { QuickTiles } from "@/components/ui/QuickTiles";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { primaryImageUrl } from "@/data/media/urls";
import { dmy, inventoryValue, isLowStock, moveDelta, moveMeta, units } from "@/components/inventory/inventory";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type {
  RemotePreparation,
  RemoteProduct,
  RemoteStockMove,
} from "@/data/http/mappers";
import { useEntityId } from "@/components/shell/entity-route";
import { inventoryStore } from "@/store/inventoryStore";
import { ProductImageManager } from "@/components/product/ProductImageManager";

const REASON_LABEL: Record<string, string> = {
  surtir: "Surtir",
  me_lo_comi: "Me lo comí",
  regalar: "Regalo",
  perdido: "Perdido / dañado",
  sale: "Venta",
  adjust: "Ajuste",
  inicial: "Stock inicial",
  devolucion: "Devolución",
  preparacion: "Preparación",
};

export default function ProductoFichaPage() {
  const id = useEntityId();
  const [product, setProduct] = useState<RemoteProduct | null>(null);
  const [moves, setMoves] = useState<RemoteStockMove[]>([]);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editLow, setEditLow] = useState("");
  const [editSellable, setEditSellable] = useState(true);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [fromPreparations, setFromPreparations] = useState<RemotePreparation[]>([]);
  const [intoPreparations, setIntoPreparations] = useState<RemotePreparation[]>([]);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const p = await inventoryStore.getProduct(id);
    setProduct(p ?? null);
    if (p) {
      setEditName(p.name);
      setEditPrice(String(p.price));
      setEditLow(String(p.lowStockAt));
      setEditSellable(p.sellable);
    }
    if (p) {
      setMoves(await inventoryStore.listProductMoves(id));
      const [from, into] = await Promise.all([
        inventoryStore.listPreparations({ sourceId: id }).catch(() => [] as RemotePreparation[]),
        inventoryStore.listPreparations({ targetId: id }).catch(() => [] as RemotePreparation[]),
      ]);
      setFromPreparations(from);
      setIntoPreparations(into);
    }
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return (
      <div className="flex flex-col gap-4">
        <SkeletonHero title="Producto" />
        <SkeletonRows />
      </div>
    );
  }

  if (!product) {
    return (
      <HeroBlock size="medium" back={{ href: "/inventario", label: "Volver a Inventario", entity: true }} title="Inventario">
        <StateBlock onHero kind="empty" title="No encontramos ese producto." />
      </HeroBlock>
    );
  }

  const isInsumo = product.sellable === false;
  const low = isLowStock(product);
  const saveEdit = () => {
              if (editBusy) return;
              setEditBusy(true);
              setEditError(null);
              void inventoryStore
                .patchProduct({
                  productId: product.id,
                  name: editName,
                  priceRaw: editPrice,
                  lowStockAtRaw: editLow,
                  sellable: editSellable,
                })
                .then(() => inventoryStore.getProduct(product.id))
                .then((updated) => {
                  if (updated) {
                    setProduct(updated);
                    setEditName(updated.name);
                    setEditPrice(String(updated.price));
                    setEditLow(String(updated.lowStockAt));
                    setEditSellable(updated.sellable);
                  }
                  setEditing(false);
                })
                .catch((e: unknown) => {
                  setEditError(e instanceof Error ? e.message : "No se pudo guardar.");
                })
                .finally(() => setEditBusy(false));
            };
  const doArchive = () => {
                if (editBusy) return;
                setEditBusy(true);
                setEditError(null);
                void inventoryStore
                  .archiveProduct(product.id)
                  .then(() => inventoryStore.getProduct(product.id))
                  .then((updated) => {
                    if (updated) setProduct(updated);
                    setConfirmArchive(false);
                  })
                  .catch((e: unknown) => {
                    setEditError(e instanceof Error ? e.message : "No se pudo archivar.");
                  })
                  .finally(() => setEditBusy(false));
              };
  const hasPreps = fromPreparations.length > 0 || intoPreparations.length > 0;

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="medium"
        back={{ href: "/inventario", label: "Volver a Inventario", entity: true }}
        action={
          <HeroPill
            label={editing ? "Cerrar" : "Editar"}
            onClick={() => {
              setEditing((v) => !v);
              setEditError(null);
            }}
          />
        }
      >
        <div className="mt-4 flex items-center gap-3">
          <ProductThumbnail secureUrl={primaryImageUrl(product.images)} alt={product.name} size="md" decorative />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight">{product.name}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {isInsumo ? <Badge tone="warning">Insumo</Badge> : null}
              {product.archivedAt ? <Badge tone="danger">Archivado</Badge> : null}
            </div>
          </div>
        </div>
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-on-hero-muted">Stock</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-3">
            <p className="text-5xl font-semibold leading-none tracking-tight tabular-nums">{units(product.stock)}</p>
            {low ? (
              <p className="flex items-center gap-1.5 text-sm text-on-hero-muted">
                <span aria-hidden className="size-2 rounded-full bg-danger" />
                {product.stock <= 0 ? "Agotado" : "Stock bajo"} (umbral {product.lowStockAt})
              </p>
            ) : null}
          </div>
        </div>
        {!product.archivedAt ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <HeroPill primary label="Surtir" href={`/inventario/${product.id}/surtir`} />
            {isInsumo ? <HeroPill label="Preparar" href={`/inventario/${product.id}/preparar`} /> : null}
          </div>
        ) : null}
      </HeroBlock>

      <Sheet>
        <SegmentedMetrics
          label={isInsumo ? "Valor del lote" : "Precio, costo y valor"}
          items={
            isInsumo
              ? [
                  // Insumo: no sale price; avgCost already is the remaining lot value (shown once).
                  product.avgCost > 0
                    ? { icon: "bag", label: "Valor restante del lote", value: formatCop(product.avgCost) }
                    : { icon: "clock", label: "Costo pendiente", value: "—", detail: product.stock > 0 ? "Se llena al surtir" : undefined },
                  { icon: "alert", label: "Umbral stock bajo", value: units(product.lowStockAt) },
                ]
              : [
                  { icon: "cash", label: "Precio", value: formatCop(product.price) },
                  product.avgCost > 0
                    ? { icon: "bag", label: "Costo prom.", value: formatCop(product.avgCost) }
                    : { icon: "clock", label: "Costo pendiente", value: "—", detail: product.stock > 0 ? "Se llena al surtir" : undefined },
                  { icon: "package", label: "Valor inventario", value: formatCop(inventoryValue(product)) },
                ]
          }
        />

        {!product.archivedAt ? (
          <section className="flex flex-col gap-0">
            <SectionHead title="Ajustes" />
            <QuickTiles
              tiles={[
                { href: `/inventario/${product.id}/me-lo-comi`, label: "Me lo comí", icon: "bag" },
                { href: `/inventario/${product.id}/regalo`, label: "Regalo", icon: "plus" },
                { href: `/inventario/${product.id}/perdido`, label: "Perdido / dañado", icon: "alert" },
              ]}
            />
          </section>
        ) : null}

        {/* ProductImageManager renders its own «Fotos» heading. */}
        <ProductImageManager productId={product.id} images={product.images} onChanged={() => void load()} />

        {hasPreps ? (
          <section className="flex flex-col gap-2">
            <SectionHead title="Preparaciones" />
            <RowGroup label="Preparaciones">
              {fromPreparations.map((r) => (
                <Row
                  key={r.id}
                  title={`${units(r.qty)} → ${r.targetName}`}
                  meta={[dmy(r.occurredOn), r.note].filter(Boolean).join(" · ")}
                  trailing={
                    <span className="text-sm font-semibold tabular-nums">
                      {r.unitCost == null ? "Costo pendiente" : `${formatCop(r.unitCost)} c/u`}
                    </span>
                  }
                />
              ))}
              {intoPreparations.map((r) => (
                <Row
                  key={r.id}
                  title={`Desde ${r.sourceName} · ${units(r.qty)}`}
                  meta={[dmy(r.occurredOn), r.note].filter(Boolean).join(" · ")}
                  trailing={
                    <span className="text-sm font-semibold tabular-nums">
                      {r.unitCost == null ? "Costo pendiente" : `${formatCop(r.unitCost)} c/u`}
                    </span>
                  }
                />
              ))}
            </RowGroup>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <SectionHead title="Historial" />
          {moves.length > 0 ? (
            <RowGroup label="Historial">
              {moves.slice(0, 20).map((m) => {
                const d = moveDelta(m.delta);
                return (
                  <Row
                    key={m.id}
                    title={REASON_LABEL[m.reason] ?? m.reason}
                    meta={moveMeta(m)}
                    trailing={
                      <>
                        <span className={`text-[15px] font-semibold tabular-nums ${d.tone === "ok" ? "text-ok" : "text-danger"}`}>
                          {d.sign}
                          {d.qty}
                        </span>
                        <span className="text-xs text-ink-muted">{d.word}</span>
                      </>
                    }
                  />
                );
              })}
            </RowGroup>
          ) : (
            <RowGroupNote>
              Sin movimientos de los últimos 90 días. Uno más viejo no está disponible sin conexión.
            </RowGroupNote>
          )}
        </section>

        {editing ? (
          <section className="flex flex-col gap-2">
            <SectionHead title="Editar" />
            <div className="rounded-[var(--r-lg)] border border-border bg-surface p-3">
              <label className="text-sm font-medium" htmlFor="editar-nombre-prod">
                Nombre
              </label>
              <Input id="editar-nombre-prod" value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-2" />
              <label className="mt-3 block text-sm font-medium" htmlFor="editar-precio-prod">
                Precio de venta
              </label>
              <Input
                id="editar-precio-prod"
                inputMode="numeric"
                value={editPrice}
                onChange={(e) => setEditPrice(e.target.value.replace(/\D/g, ""))}
                className="mt-2"
              />
              <label className="mt-3 block text-sm font-medium" htmlFor="editar-low-prod">
                Umbral stock bajo (avisar cuando sea menor o igual a)
              </label>
              <Input
                id="editar-low-prod"
                inputMode="numeric"
                value={editLow}
                onChange={(e) => setEditLow(e.target.value.replace(/\D/g, ""))}
                className="mt-2"
              />
              <label className="mt-3 flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={!editSellable}
                  onChange={(e) => setEditSellable(!e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 rounded border-border"
                />
                <span>
                  <span className="font-medium">Es insumo o combo</span>
                  <span className="mt-1 block text-ink-muted">
                    No aparece para vender ni en el catálogo de clientes. Sirve como origen de preparaciones.
                  </span>
                </span>
              </label>
              {editError && !confirmArchive && <p className="mt-2 text-sm text-danger">{editError}</p>}
              <Button type="button" variant="primary" disabled={editBusy} onClick={saveEdit} className="mt-3 w-full">
                Guardar cambios
              </Button>
              <p className="mt-2 text-xs text-ink-muted">
                El stock y el costo solo cambian con movimientos. Las ventas anteriores conservan el precio con el que se
                cobraron.
              </p>
            </div>
          </section>
        ) : null}

        {!product.archivedAt ? (
          <section className="flex flex-col gap-2" aria-label="Zona de riesgo">
            {!confirmArchive ? (
              <button
                type="button"
                onClick={() => setConfirmArchive(true)}
                className="min-h-11 rounded-[var(--r-lg)] border border-border bg-surface px-3 text-left text-sm font-semibold text-danger"
              >
                Archivar producto
              </button>
            ) : (
              <div className="rounded-[var(--r-lg)] border border-danger/30 bg-surface p-3">
                <p className="text-sm font-semibold text-ink">¿Archivar este producto?</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                  Dejará de aparecer para vender o surtir, pero su historial se conserva. Esta acción no se puede deshacer
                  desde aquí.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button type="button" variant="secondary" disabled={editBusy} onClick={() => setConfirmArchive(false)}>
                    Cancelar
                  </Button>
                  <Button type="button" variant="danger" disabled={editBusy} onClick={doArchive}>
                    Archivar
                  </Button>
                </div>
                {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}
              </div>
            )}
          </section>
        ) : null}
      </Sheet>
    </div>
  );
}
