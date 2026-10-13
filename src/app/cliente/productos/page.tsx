"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerChrome, PortalError, PortalLoading } from "@/components/customer/CustomerChrome";
import { ProductImageView } from "@/components/product/ProductImageView";
import type { CustomerCatalogProduct } from "@/data/http/customer-api";
import { loadCachedCustomerCatalog } from "@/data/pwa/customer-catalog-cache";
import { formatCop } from "@/domain/money";
import { Badge } from "@/components/ui/Badge";
import { StateBlock } from "@/components/ui/StateBlock";

export default function CustomerProductsPage() {
  const [products, setProducts] = useState<CustomerCatalogProduct[] | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    void loadCachedCustomerCatalog()
      .then((result) => {
        setProducts(result.products);
        setCapturedAt(result.capturedAt);
        setFromCache(result.source === "cache");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "No se pudo cargar.");
      });
  }

  useEffect(load, []);

  return (
    <CustomerChrome title="Productos" capturedAt={fromCache ? capturedAt : null}>
      {error ? (
        <PortalError message={error} onRetry={load} />
      ) : products === null ? (
        <PortalLoading />
      ) : products.length === 0 ? (
        <StateBlock kind="empty" title="Aún no hay productos para mostrar." />
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {products.map((p) => {
            const primary = p.images.find((img) => img.isPrimary) ?? p.images[0] ?? null;
            return (
              <li key={p.id}>
                {/* Read-only tile: no cart in the portal. */}
                <Link
                  href={`/cliente/productos/${p.id}`}
                  className="flex h-full flex-col gap-2 rounded-[var(--r-lg)] border border-border bg-surface p-2"
                >
                  <ProductImageView
                    secureUrl={primary?.secureUrl ?? null}
                    alt={p.name}
                    variant="thumb"
                    className="aspect-square w-full"
                  />
                  <span className="min-w-0 px-1 pb-1">
                    <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
                    <span className="mt-0.5 block text-sm font-semibold tabular-nums text-ink">{formatCop(p.price)}</span>
                    {!p.available ? (
                      <span className="mt-1 block">
                        <Badge tone="danger">Agotado por ahora</Badge>
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </CustomerChrome>
  );
}
