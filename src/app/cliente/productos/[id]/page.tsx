"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CustomerChrome,
  CustomerCacheNotice,
} from "@/components/customer/CustomerChrome";
import { ProductImageView } from "@/components/product/ProductImageView";
import type { CustomerCatalogProduct } from "@/data/http/customer-api";
import {
  loadCachedCustomerCatalog,
  primaryCatalogImage,
} from "@/data/pwa/customer-catalog-cache";
import { routeId } from "@/data/pwa/ids";
import { formatCop } from "@/domain/money";

export default function CustomerProductDetailPage() {
  const params = useParams();
  const id = routeId(params.id);
  const [product, setProduct] = useState<CustomerCatalogProduct | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!id) {
      setMissing(true);
      return;
    }
    void loadCachedCustomerCatalog()
      .then((result) => {
        const found = result.products.find((p) => p.id === id) ?? null;
        setProduct(found);
        setMissing(!found);
        setCapturedAt(result.capturedAt);
        setFromCache(result.source === "cache");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "No se pudo cargar.");
      });
  }, [id]);

  if (error) {
    return (
      <CustomerChrome title="Producto">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }

  if (missing || !product) {
    return (
      <CustomerChrome title="Producto">
        <p className="text-sm text-ink/60">No encontramos ese producto.</p>
        <Link
          href="/cliente/productos"
          className="text-sm font-semibold text-ink/70"
        >
          ← Productos
        </Link>
      </CustomerChrome>
    );
  }

  const primary = primaryCatalogImage(product) ?? product.images[0] ?? null;
  const gallery = primary
    ? [primary, ...product.images.filter((img) => img.id !== primary.id)]
    : [];
  const current = gallery[Math.min(selected, Math.max(0, gallery.length - 1))] ?? null;

  return (
    <CustomerChrome title={product.name}>
      {fromCache && capturedAt != null && (
        <CustomerCacheNotice capturedAt={capturedAt} />
      )}
      <Link
        href="/cliente/productos"
        className="text-sm font-semibold text-ink/70"
      >
        ← Productos
      </Link>
      <ProductImageView
        secureUrl={current?.secureUrl ?? null}
        alt={current?.altText || product.name}
        variant="detail"
        eager
        className="aspect-square w-full"
      />
      {gallery.length > 1 && (
        <ul className="grid grid-cols-4 gap-2" aria-label="Galería">
          {gallery.map((img, index) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-label={`Ver foto ${index + 1}`}
                aria-pressed={index === selected}
                className={`w-full overflow-hidden rounded-2xl border ${
                  index === selected ? "border-cta" : "border-ink/10"
                }`}
              >
                <ProductImageView
                  secureUrl={img.secureUrl}
                  alt=""
                  variant="thumb"
                  className="aspect-square w-full !rounded-none !border-0"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
          Precio
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {formatCop(product.price)}
        </p>
        <p
          className={`mt-1 text-sm font-semibold ${
            product.available ? "text-ok" : "text-ink/50"
          }`}
        >
          {product.available ? "Disponible" : "Agotado por ahora"}
        </p>
      </section>
    </CustomerChrome>
  );
}
