"use client";

import { useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { Product } from "@/domain/types";
import { productRepository } from "@/repositories";

export default function InventarioPage() {
  const [products, setProducts] = useState<Product[]>([]);

  useEffect(() => {
    void productRepository.list().then(setProducts);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold">Inventario</h1>
      {products.length === 0 ? (
        <p className="text-sm text-ink/60">
          No hay productos. Súbelos en Inventario.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {products.map((p) => (
            <li
              key={p.id}
              className="rounded-2xl border border-ink/[0.08] bg-white p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-ink/50">{p.category}</p>
                </div>
                <p className="text-sm font-semibold">{formatCop(p.price)}</p>
              </div>
              <p
                className={`mt-2 text-xs ${p.stock <= p.lowStockAt ? "text-danger" : "text-ink/60"}`}
              >
                Stock {p.stock}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
