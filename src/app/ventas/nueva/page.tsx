"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatCop, mulCop, addCop } from "@/domain/money";
import { parseSaleUnitPrice } from "@/domain/sale/validate";
import type { RemoteProduct } from "@/data/http/mappers";
import { primaryImageUrl } from "@/data/media/urls";
import { ProductTile } from "@/components/product/ProductTile";
import { navigateOfflineAware } from "@/data/pwa/offline-nav";
import { listCachedProducts } from "@/data/pwa/catalog";
import { useCart } from "@/store/cartStore";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroSearch } from "@/components/ui/HeroSearch";
import { Sheet } from "@/components/ui/Sheet";
import { StateBlock } from "@/components/ui/StateBlock";
import { ActionBar, ACTION_BAR_SPACE } from "@/components/ui/ActionBar";

export default function NuevaVentaPage() {
  const router = useRouter();
  const { items, setQty, setUnitPrice, totalQty } = useCart();
  const [products, setProducts] = useState<RemoteProduct[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [pendingPrices, setPendingPrices] = useState<Record<string, number>>({});

  useEffect(() => {
    void listCachedProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  }, []);

  const categories = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.category))).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (p.sellable === false) return false;
      const matchCat = !category || p.category === category;
      const matchQ =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [products, query, category]);

  function linePrice(product: RemoteProduct): number {
    const item = items.find((i) => i.productId === product.id);
    if (item?.unitPrice != null) return item.unitPrice;
    if (pendingPrices[product.id] != null) return pendingPrices[product.id]!;
    return product.price;
  }

  const total = useMemo(() => {
    return items.reduce((sum, item) => {
      const p = products.find((x) => x.id === item.productId);
      if (!p) return sum;
      const price = item.unitPrice ?? p.price;
      return addCop(sum, mulCop(price, item.qty));
    }, 0);
  }, [items, products]);

  function qtyOf(productId: string): number {
    return items.find((i) => i.productId === productId)?.qty ?? 0;
  }

  function bump(product: RemoteProduct, delta: number) {
    const current = qtyOf(product.id);
    const next = current + delta;
    if (next < 0) return;
    if (next > product.stock) {
      setStockError("Stock insuficiente");
      setTimeout(() => setStockError(null), 1800);
      return;
    }
    setStockError(null);
    const existing = items.find((i) => i.productId === product.id);
    const price =
      existing?.unitPrice ?? pendingPrices[product.id] ?? product.price;
    setQty(product.id, next, price);
  }

  function onPriceChange(product: RemoteProduct, raw: string) {
    const digits = raw.replace(/\D/g, "");
    const parsed = parseSaleUnitPrice(digits, product.price);
    if ("error" in parsed) return;
    if (qtyOf(product.id) > 0) {
      setUnitPrice(product.id, parsed.unitPrice);
      return;
    }
    setPendingPrices((prev) => ({ ...prev, [product.id]: parsed.unitPrice }));
  }

  const sellable = products.filter((p) => p.sellable !== false);

  return (
    <div className={`flex flex-col ${ACTION_BAR_SPACE}`}>
      <HeroBlock size="compact" back={{ href: "/", label: "Volver" }} title="Nueva venta">
        <div className="mt-4 flex flex-col gap-3">
          <HeroSearch value={query} onChange={setQuery} placeholder="Buscar dulce..." />
          {categories.length > 0 && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Categorías">
              <Chip active={category === null} onClick={() => setCategory(null)} label="Todos" />
              {categories.map((c) => (
                <Chip key={c} active={category === c} onClick={() => setCategory(c)} label={c} />
              ))}
            </div>
          )}
        </div>
      </HeroBlock>

      <Sheet>
        {sellable.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Aún no tienes productos para vender"
            action={
              <Link href="/inventario/nuevo" className="text-sm font-semibold text-ink underline underline-offset-2">
                Agregar producto
              </Link>
            }
          />
        ) : filtered.length === 0 ? (
          <StateBlock kind="empty" title="No hay productos con ese nombre." />
        ) : (
          <div className="grid grid-cols-2 gap-3 min-[560px]:grid-cols-3">
            {filtered.map((p) => (
              <ProductTile
                key={p.id}
                name={p.name}
                imageUrl={primaryImageUrl(p.images)}
                price={linePrice(p)}
                catalogPrice={p.price}
                stock={p.stock}
                lowStockAt={p.lowStockAt}
                qty={qtyOf(p.id)}
                onAdd={() => bump(p, 1)}
                onRemove={() => bump(p, -1)}
                onPriceChange={(raw) => onPriceChange(p, raw)}
              />
            ))}
          </div>
        )}
        {stockError && (
          <p role="alert" className="text-center text-sm text-danger">
            {stockError}
          </p>
        )}
      </Sheet>

      <ActionBar
        summary={`${totalQty} ${totalQty === 1 ? "producto" : "productos"} · ${formatCop(total)}`}
        primary={{
          label: "Cobrar",
          disabled: total === 0,
          onClick: () => navigateOfflineAware(router, "/ventas/cobrar"),
        }}
      />
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-sm font-semibold ${
        active
          ? "bg-nav-active-bg text-nav-active-ink"
          : "bg-[color-mix(in_srgb,var(--on-hero)_12%,transparent)] text-on-hero"
      }`}
    >
      {label}
    </button>
  );
}
