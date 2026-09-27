"use client";

import { OfflineLink } from "@/components/shell/OfflineLink";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { getPendingSupplierIds } from "@/data/pwa/offline-catalog";
import { useInventory } from "@/store/inventoryStore";

type Segment = "productos" | "proveedores";

export default function InventarioPage() {
  const {
    products,
    suppliers,
    loading,
    refreshAll,
  } = useInventory();
  const [segment, setSegment] = useState<Segment>("productos");
  const [query, setQuery] = useState("");
  const [pendingSupplierIds, setPendingSupplierIds] = useState<string[]>([]);

  useEffect(() => {
    void refreshAll();
    void getPendingSupplierIds().then(setPendingSupplierIds);
  }, [refreshAll]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, query]);

  const filteredSuppliers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.phone ?? "").toLowerCase().includes(q),
    );
  }, [suppliers, query]);

  const searching = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight">Inventario</h1>
        <OfflineLink
          href={
            segment === "productos"
              ? "/inventario/nuevo"
              : "/inventario/proveedores/nuevo"
          }
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] bg-cta text-xl font-semibold text-cta-fg"
          ariaLabel={
            segment === "productos" ? "Agregar producto" : "Agregar proveedor"
          }
        >
          +
        </OfflineLink>
      </header>

      <div className="grid grid-cols-2 gap-2 rounded-[var(--r-md)] border border-border bg-surface p-1">
        <SegmentButton
          label="Productos"
          active={segment === "productos"}
          onClick={() => {
            setSegment("productos");
            setQuery("");
          }}
        />
        <SegmentButton
          label="Proveedores"
          active={segment === "proveedores"}
          onClick={() => {
            setSegment("proveedores");
            setQuery("");
          }}
        />
      </div>

      <label className="sr-only" htmlFor="buscar-inventario">
        {segment === "productos" ? "Buscar producto" : "Buscar proveedor"}
      </label>
      <Input
        id="buscar-inventario"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          segment === "productos"
            ? "Buscar producto..."
            : "Buscar proveedor..."
        }
      />

      {loading && products.length === 0 && suppliers.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : segment === "productos" ? (
        products.length === 0 ? (
          <Empty
            title="Aún no hay productos."
            action={
              <OfflineLink
                href="/inventario/nuevo"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
              >
                Agregar producto
              </OfflineLink>
            }
          />
        ) : filteredProducts.length === 0 && searching ? (
          <p className="text-sm text-ink-muted">No hay productos con ese nombre.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filteredProducts.map((p) => {
              const low = p.stock <= p.lowStockAt;
              const agotado = p.stock <= 0;
              const primary = [...(p.images ?? [])].find((img) => img.isPrimary)
                ?? (p.images ?? [])[0];
              return (
                <li key={p.id}>
                  <OfflineLink
                    href={`/inventario/${p.id}`}
                    className="flex min-h-11 items-start justify-between gap-2 rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <ProductThumbnail
                        secureUrl={primary?.secureUrl ?? null}
                        alt={p.name}
                        size="md"
                      />
                      <div className="min-w-0">
                        <p className="font-medium">{p.name}</p>
                        <p className="mt-0.5 text-sm text-ink-muted">
                          {formatCop(p.price)}
                        </p>
                        {(agotado || low) && (
                          <Badge
                            tone={agotado ? "danger" : "warning"}
                            className="mt-1"
                          >
                            {agotado ? "Agotado" : "Stock bajo"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p
                      className={`text-sm font-semibold ${
                        agotado || low ? "text-danger" : "text-ink-muted"
                      }`}
                    >
                      Stock {p.stock}
                    </p>
                  </OfflineLink>
                </li>
              );
            })}
          </ul>
        )
      ) : suppliers.length === 0 ? (
        <Empty
          title="Aún no hay proveedores."
          action={
            <OfflineLink
              href="/inventario/proveedores/nuevo"
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
            >
              Agregar proveedor
            </OfflineLink>
          }
        />
      ) : filteredSuppliers.length === 0 && searching ? (
        <p className="text-sm text-ink-muted">No encontramos ese proveedor.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filteredSuppliers.map((s) => (
            <li key={s.id}>
              <OfflineLink
                href={`/inventario/proveedores/${s.id}`}
                className="flex min-h-11 flex-col justify-center rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
              >
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {s.name}
                  {pendingSupplierIds.includes(s.id) && (
                    <Badge tone="warning">⏳ Pendiente</Badge>
                  )}
                </span>
                {s.phone && (
                  <span className="text-sm text-ink-muted">{s.phone}</span>
                )}
              </OfflineLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SegmentButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={`w-full ${
        active ? "bg-primary text-ink hover:text-ink" : "text-ink-muted"
      }`}
    >
      {label}
    </Button>
  );
}
