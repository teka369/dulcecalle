"use client";

import Link from "next/link";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import { ProductImageView } from "@/components/product/ProductImageView";
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
        <Link
          href={
            segment === "productos"
              ? "/inventario/nuevo"
              : "/inventario/proveedores/nuevo"
          }
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] bg-cta text-xl font-semibold text-white"
          aria-label={
            segment === "productos" ? "Agregar producto" : "Agregar proveedor"
          }
        >
          +
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-2 rounded-[14px] border border-ink/10 bg-surface p-1">
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
      <input
        id="buscar-inventario"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          segment === "productos"
            ? "Buscar producto..."
            : "Buscar proveedor..."
        }
        className="min-h-11 w-full rounded-[14px] border border-ink/10 bg-surface px-3 text-base outline-none focus:border-primary"
      />

      {loading && products.length === 0 && suppliers.length === 0 ? (
        <p className="text-sm text-ink/60">Cargando…</p>
      ) : segment === "productos" ? (
        products.length === 0 ? (
          <EmptyBlock
            message="Aún no hay productos."
            cta="Agregar producto"
            href="/inventario/nuevo"
          />
        ) : filteredProducts.length === 0 && searching ? (
          <p className="text-sm text-ink/60">No hay productos con ese nombre.</p>
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
                    className="flex min-h-11 items-start justify-between gap-2 rounded-2xl border border-ink/[0.08] bg-surface p-4"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <ProductImageView
                        secureUrl={primary?.secureUrl ?? null}
                        alt={p.name}
                        variant="thumb"
                        className="h-14 w-14 shrink-0"
                      />
                      <div className="min-w-0">
                      <p className="font-medium">{p.name}</p>
                      <p className="mt-0.5 text-sm text-ink/60">
                        {formatCop(p.price)}
                      </p>
                      {(agotado || low) && (
                        <span
                          className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                            agotado
                              ? "bg-danger/15 text-danger"
                              : "bg-primary/40 text-ink"
                          }`}
                        >
                          {agotado ? "Agotado" : "Stock bajo"}
                        </span>
                      )}
                      </div>
                    </div>
                    <p
                      className={`text-sm font-semibold ${
                        agotado
                          ? "text-danger"
                          : low
                            ? "text-danger"
                            : "text-ink/70"
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
        <EmptyBlock
          message="Aún no hay proveedores."
          cta="Agregar proveedor"
          href="/inventario/proveedores/nuevo"
        />
      ) : filteredSuppliers.length === 0 && searching ? (
        <p className="text-sm text-ink/60">No encontramos ese proveedor.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filteredSuppliers.map((s) => (
            <li key={s.id}>
              <OfflineLink
                href={`/inventario/proveedores/${s.id}`}
                className="flex min-h-11 flex-col justify-center rounded-2xl border border-ink/[0.08] bg-surface p-4"
              >
                <span className="font-medium">
                  {s.name}
                  {pendingSupplierIds.includes(s.id) && (
                    <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-semibold text-ink/70">
                      ⏳ Pendiente
                    </span>
                  )}
                </span>
                {s.phone && (
                  <span className="text-sm text-ink/50">{s.phone}</span>
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
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-[12px] text-sm font-semibold ${
        active ? "bg-primary text-ink" : "bg-transparent text-ink/60"
      }`}
    >
      {label}
    </button>
  );
}

function EmptyBlock({
  message,
  cta,
  href,
}: {
  message: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="rounded-2xl border border-ink/10 bg-surface p-6 text-center">
      <p className="text-base font-medium">{message}</p>
      <Link
        href={href}
        className="mt-4 inline-flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
      >
        {cta}
      </Link>
    </div>
  );
}
