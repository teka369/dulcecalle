"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerChrome, PortalError, PortalLoading } from "@/components/customer/CustomerChrome";
import { ProductImageView } from "@/components/product/ProductImageView";
import type { CustomerCatalogProduct } from "@/data/http/customer-api";
import {
  loadCachedCustomerCatalog,
  primaryCatalogImage,
} from "@/data/pwa/customer-catalog-cache";
import { routeId } from "@/data/pwa/ids";
import { formatCop } from "@/domain/money";
import { Badge } from "@/components/ui/Badge";
import { StateBlock } from "@/components/ui/StateBlock";

export default function CustomerProductDetailPage() {
  const params = useParams();
  const id = routeId(params.id);
  const [product, setProduct] = useState<CustomerCatalogProduct | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!id) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setLoading(true);
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
      })
      .finally(() => setLoading(false));
  }, [id]);

  const BACK = { href: "/cliente/productos", label: "Volver a Productos" };

  if (error) {
    return (
      <CustomerChrome title="Producto" back={BACK}>
        <PortalError message={error} />
      </CustomerChrome>
    );
  }

  if (loading) {
    return (
      <CustomerChrome title="Producto" back={BACK}>
        <PortalLoading />
      </CustomerChrome>
    );
  }

  if (missing || !product) {
    return (
      <CustomerChrome title="Producto" back={BACK}>
        <StateBlock kind="empty" title="No encontramos ese producto." />
      </CustomerChrome>
    );
  }

  const primary = primaryCatalogImage(product) ?? product.images[0] ?? null;
  const gallery = primary ? [primary, ...product.images.filter((img) => img.id !== primary.id)] : [];
  const current = gallery[Math.min(selected, Math.max(0, gallery.length - 1))] ?? null;

  return (
    <CustomerChrome
      title={product.name}
      back={BACK}
      capturedAt={fromCache ? capturedAt : null}
      hero={
        <div className="mt-4 flex flex-col gap-3">
          <div className="-mx-4 overflow-hidden">
            <ProductImageView
              secureUrl={current?.secureUrl ?? null}
              alt={current?.altText || product.name}
              variant="detail"
              eager
              className="aspect-square w-full !rounded-none"
            />
          </div>
          <p className="text-4xl font-semibold tabular-nums">{formatCop(product.price)}</p>
          <p className="flex items-center gap-1.5 text-sm text-on-hero-muted">
            <span aria-hidden className={`size-2 rounded-full ${product.available ? "bg-ok" : "bg-danger"}`} />
            {product.available ? "Disponible" : "Agotado por ahora"}
          </p>
        </div>
      }
    >
      {gallery.length > 1 ? (
        <ul className="grid grid-cols-4 gap-2" aria-label="Galería">
          {gallery.map((img, index) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-label={`Ver foto ${index + 1}`}
                aria-pressed={index === selected}
                className={`w-full overflow-hidden rounded-[var(--r-lg)] border-2 ${index === selected ? "border-cta" : "border-border"}`}
              >
                <ProductImageView secureUrl={img.secureUrl} alt="" variant="thumb" className="aspect-square w-full !rounded-none !border-0" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">Precio de referencia. Pregunta en la tienda por disponibilidad.</p>
      )}
      {product.available ? null : <Badge tone="danger">Agotado por ahora</Badge>}
    </CustomerChrome>
  );
}
