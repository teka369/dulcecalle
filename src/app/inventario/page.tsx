"use client";

import { OfflineLink } from "@/components/shell/OfflineLink";
import { useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { getPendingSupplierIds } from "@/data/pwa/offline-catalog";
import { useSync } from "@/store/syncStore";
import { heroFigures, listBand, listGate } from "@/data/pwa/list-status";
import { ListErrorState } from "@/components/ui/ListErrorState";
import { useInventory } from "@/store/inventoryStore";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroPill } from "@/components/ui/HeroPill";
import { HeroSearch } from "@/components/ui/HeroSearch";
import { HeroSegmented } from "@/components/ui/HeroSegmented";
import { SegmentedMetrics } from "@/components/ui/SegmentedMetrics";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { PendingBadge } from "@/components/ui/StatusBadge";
import { inventoryCounts, isOutOfStock, splitByStock, units } from "@/components/inventory/inventory";
import type { RemoteProduct } from "@/data/http/mappers";

type Segment = "productos" | "proveedores";

const CTA_LINK =
  "inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg";

function ProductRow({ p, low }: { p: RemoteProduct; low: boolean }) {
  const primary = (p.images ?? []).find((img) => img.isPrimary) ?? (p.images ?? [])[0];
  const meta = [low ? `umbral ${p.lowStockAt}` : null, formatCop(p.price)].filter(Boolean).join(" · ");
  return (
    <Row
      href={`/inventario/${p.id}`}
      leading={<ProductThumbnail secureUrl={primary?.secureUrl ?? null} alt={p.name} size="sm" decorative />}
      title={p.name}
      meta={meta}
      trailing={
        <>
          <span className={`text-[15px] font-semibold tabular-nums ${low ? "text-danger" : "text-ink"}`}>{units(p.stock)}</span>
          {low ? <span className="text-xs text-danger">{isOutOfStock(p) ? "Agotado" : "Stock bajo"}</span> : null}
        </>
      }
    />
  );
}

export default function InventarioPage() {
  const { products, suppliers, loading, refreshAll, listStatus } = useInventory();
  const { online } = useSync();
  const [segment, setSegment] = useState<Segment>("productos");
  const [query, setQuery] = useState("");
  const [pendingSupplierIds, setPendingSupplierIds] = useState<string[]>([]);

  useEffect(() => {
    void refreshAll().catch(() => undefined);
    void getPendingSupplierIds().then(setPendingSupplierIds);
  }, [refreshAll]);

  const counts = useMemo(() => inventoryCounts(products), [products]);
  const split = useMemo(() => splitByStock(products, query), [products, query]);
  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q) || (s.phone ?? "").toLowerCase().includes(q));
  }, [suppliers, query]);

  const isProducts = segment === "productos";
  // B3: a failed read never renders as "Aún no hay productos/proveedores".
  const gate = listGate({ loading, count: isProducts ? products.length : suppliers.length, status: listStatus });
  const band = listBand(listStatus, online, products.length + suppliers.length);
  // Hero figures are always about products, whatever segment is shown.
  const figures = heroFigures(listGate({ loading, count: products.length, status: listStatus }));
  const searching = query.trim().length > 0;

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="tall"
        title="Inventario"
        offline={band}
        action={
          <HeroPill
            label={isProducts ? "Agregar producto" : "Agregar proveedor"}
            href={isProducts ? "/inventario/nuevo" : "/inventario/proveedores/nuevo"}
          />
        }
      >
        <div className="mt-5">
          <SegmentedMetrics
            label="Resumen de inventario"
            items={[
              { icon: "package", label: "productos", loading: figures === "skeleton", value: figures === "error" ? "—" : String(counts.products) },
              { icon: "alert", label: "stock bajo", loading: figures === "skeleton", value: figures === "error" ? "—" : String(counts.low), tone: counts.low > 0 ? "danger" : "neutral" },
            ]}
          />
        </div>
        <div className="mt-4">
          <HeroSegmented<Segment>
            label="Ver"
            value={segment}
            onChange={(s) => {
              setSegment(s);
              setQuery("");
            }}
            options={[
              { id: "productos", label: "Productos" },
              { id: "proveedores", label: "Proveedores" },
            ]}
          />
        </div>
        <div className="mt-3">
          <HeroSearch
            value={query}
            onChange={setQuery}
            placeholder={isProducts ? "Buscar producto..." : "Buscar proveedor..."}
            label={isProducts ? "Buscar producto" : "Buscar proveedor"}
          />
        </div>
      </HeroBlock>

      <Sheet>
        {gate === "loading" ? (
          <SkeletonRows />
        ) : gate === "error" ? (
          <ListErrorState message={listStatus.error} online={online} onRetry={() => void refreshAll().catch(() => undefined)} />
        ) : isProducts ? (
          products.length === 0 ? (
            <StateBlock
              kind="empty"
              title="Aún no hay productos."
              action={
                <OfflineLink href="/inventario/nuevo" className={CTA_LINK}>
                  Agregar producto
                </OfflineLink>
              }
            />
          ) : split.low.length + split.rest.length === 0 && searching ? (
            <RowGroupNote>No hay productos con ese nombre.</RowGroupNote>
          ) : (
            <>
              {split.low.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <SectionHead title="Stock bajo" />
                  <RowGroup label="Stock bajo">
                    {split.low.map((p) => (
                      <ProductRow key={p.id} p={p} low />
                    ))}
                  </RowGroup>
                </section>
              ) : null}
              {split.rest.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <SectionHead title="Todos" />
                  <RowGroup label="Todos los productos">
                    {split.rest.map((p) => (
                      <ProductRow key={p.id} p={p} low={false} />
                    ))}
                  </RowGroup>
                </section>
              ) : null}
            </>
          )
        ) : suppliers.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Aún no hay proveedores."
            action={
              <OfflineLink href="/inventario/proveedores/nuevo" className={CTA_LINK}>
                Agregar proveedor
              </OfflineLink>
            }
          />
        ) : filteredSuppliers.length === 0 && searching ? (
          <RowGroupNote>No encontramos ese proveedor.</RowGroupNote>
        ) : (
          <RowGroup label="Proveedores">
            {filteredSuppliers.map((s) => (
              <Row
                key={s.id}
                href={`/inventario/proveedores/${s.id}`}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {s.name}
                    {pendingSupplierIds.includes(s.id) ? <PendingBadge /> : null}
                  </span>
                }
                meta={s.phone || undefined}
              />
            ))}
          </RowGroup>
        )}
      </Sheet>
    </div>
  );
}
