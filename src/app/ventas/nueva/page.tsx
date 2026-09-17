"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatCop, mulCop, addCop } from "@/domain/money";
import type { Product } from "@/domain/types";
import { productRepository } from "@/repositories";
import { useCart } from "@/store/cartStore";

export default function NuevaVentaPage() {
  const router = useRouter();
  const { items, setQty, totalQty } = useCart();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);

  useEffect(() => {
    void productRepository.list().then(setProducts);
  }, []);

  const categories = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.category))).sort();
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      const matchCat = !category || p.category === category;
      const matchQ =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [products, query, category]);

  const total = useMemo(() => {
    return items.reduce((sum, item) => {
      const p = products.find((x) => x.id === item.productId);
      if (!p) return sum;
      return addCop(sum, mulCop(p.price, item.qty));
    }, 0);
  }, [items, products]);

  function qtyOf(productId: number): number {
    return items.find((i) => i.productId === productId)?.qty ?? 0;
  }

  function bump(product: Product, delta: number) {
    const current = qtyOf(product.id!);
    const next = current + delta;
    if (next < 0) return;
    if (next > product.stock) {
      setStockError("Stock insuficiente");
      setTimeout(() => setStockError(null), 1800);
      return;
    }
    setStockError(null);
    setQty(product.id!, next);
  }

  return (
    <div className="flex min-h-[calc(100dvh-2rem)] flex-col gap-3">
      <header className="flex items-center gap-2">
        <Link
          href="/"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Nueva venta</h1>
      </header>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar dulce..."
        className="min-h-11 w-full rounded-[14px] border border-ink/10 bg-white px-3 text-base outline-none focus:border-primary"
      />

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <Chip
          active={category === null}
          onClick={() => setCategory(null)}
          label="Todos"
        />
        {categories.map((c) => (
          <Chip
            key={c}
            active={category === c}
            onClick={() => setCategory(c)}
            label={c}
          />
        ))}
      </div>

      {products.length === 0 ? (
        <p className="text-sm text-ink/60">
          No hay productos. Súbelos en Inventario.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 pb-28">
          {filtered.map((p) => {
            const qty = qtyOf(p.id!);
            return (
              <article
                key={p.id}
                className="flex flex-col rounded-2xl border border-ink/[0.08] bg-white p-3"
              >
                <p className="line-clamp-2 min-h-10 text-sm font-medium">
                  {p.name}
                </p>
                <p className="mt-1 text-sm font-semibold">{formatCop(p.price)}</p>
                <div className="mt-auto flex items-center justify-between pt-3">
                  <button
                    type="button"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] bg-bg text-lg font-semibold"
                    onClick={() => bump(p, -1)}
                    aria-label="Menos"
                  >
                    −
                  </button>
                  <span className="min-w-6 text-center text-sm font-semibold">
                    {qty}
                  </span>
                  <button
                    type="button"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] bg-bg text-lg font-semibold"
                    onClick={() => bump(p, 1)}
                    aria-label="Más"
                  >
                    +
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {stockError && (
        <p className="text-center text-sm text-danger">{stockError}</p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {totalQty} ítems · {formatCop(total)}
          </p>
          <button
            type="button"
            disabled={total === 0}
            onClick={() => router.push("/ventas/cobrar")}
            className="min-h-11 rounded-[14px] bg-cta px-5 text-sm font-semibold text-white disabled:opacity-40"
          >
            Cobrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({
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
      className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-medium ${
        active ? "bg-primary text-ink" : "bg-white text-ink/70 border border-ink/10"
      }`}
    >
      {label}
    </button>
  );
}
