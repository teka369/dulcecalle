"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CustomerChrome,
  CustomerCacheNotice,
} from "@/components/customer/CustomerChrome";
import { ProductImageView } from "@/components/product/ProductImageView";
import type { CustomerCatalogProduct } from "@/data/http/customer-api";
import { loadCachedCustomerCatalog } from "@/data/pwa/customer-catalog-cache";
import { formatCop } from "@/domain/money";

export default function CustomerProductsPage() {
  const [products, setProducts] = useState<CustomerCatalogProduct[]>([]);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadCachedCustomerCatalog()
      .then((result) => {
        setProducts(result.products);
        setCapturedAt(result.capturedAt);
        setFromCache(result.source === "cache");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "No se pudo cargar.");
      });
  }, []);

  if (error) {
    return (
      <CustomerChrome title="Productos">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }

  return (
    <CustomerChrome title="Productos">
      {fromCache && capturedAt != null && (
        <CustomerCacheNotice capturedAt={capturedAt} />
      )}
      {products.length === 0 ? (
        <p className="text-sm text-ink/60">Aún no hay productos para mostrar.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {products.map((p) => {
            const primary =
              p.images.find((img) => img.isPrimary) ?? p.images[0] ?? null;
            return (
              <li key={p.id}>
                <Link
                  href={`/cliente/productos/${p.id}`}
                  className="flex min-h-11 flex-col gap-2 rounded-2xl border border-ink/[0.08] bg-surface p-3"
                >
                  <ProductImageView
                    secureUrl={primary?.secureUrl ?? null}
                    alt={p.name}
                    variant="thumb"
                    className="aspect-square w-full"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {p.name}
                    </span>
                    <span className="mt-0.5 block text-sm font-semibold tabular-nums">
                      {formatCop(p.price)}
                    </span>
                    <span
                      className={`mt-0.5 block text-xs ${
                        p.available ? "text-ok" : "text-ink/50"
                      }`}
                    >
                      {p.available ? "Disponible" : "Agotado"}
                    </span>
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
