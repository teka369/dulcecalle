"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { Product, StockMove } from "@/domain/types";
import { inventoryStore } from "@/store/inventoryStore";

const REASON_LABEL: Record<string, string> = {
  surtir: "Surtir",
  me_lo_comi: "Me lo comí",
  regalar: "Regalo",
  perdido: "Perdido / dañado",
  sale: "Venta",
  adjust: "Ajuste",
  inicial: "Stock inicial",
};

export default function ProductoFichaPage() {
  const params = useParams();
  const id = Number(params.id);
  const [product, setProduct] = useState<Product | null>(null);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setReady(true);
      return;
    }
    const p = await inventoryStore.getProduct(id);
    setProduct(p ?? null);
    if (p) {
      setMoves(await inventoryStore.listProductMoves(id));
    }
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!product) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/inventario" className="text-sm text-ink/70">
          ← Inventario
        </Link>
        <p className="text-sm text-ink/60">No encontramos ese producto.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/inventario"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {product.name}
        </h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
          Stock
        </p>
        <p className="mt-1 text-2xl font-semibold">{product.stock}</p>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink/50">
          Precio venta
        </p>
        <p className="mt-1 text-lg font-semibold">{formatCop(product.price)}</p>
        {product.avgCost > 0 && (
          <p className="mt-2 text-sm text-ink/50">
            Costo prom. {formatCop(product.avgCost)}
          </p>
        )}
      </section>

      <Link
        href={`/inventario/${product.id}/surtir`}
        className="flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
      >
        Surtir
      </Link>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink/60">
          Ajustes de stock
        </h2>
        <div className="flex flex-col gap-2">
          <ActionLink
            href={`/inventario/${product.id}/me-lo-comi`}
            label="Me lo comí"
          />
          <ActionLink
            href={`/inventario/${product.id}/regalo`}
            label="Regalo"
          />
          <ActionLink
            href={`/inventario/${product.id}/perdido`}
            label="Perdido / dañado"
          />
        </div>
      </section>

      {moves.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink/60">Historial</h2>
          <ul className="flex flex-col gap-2">
            {moves.slice(0, 20).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-2xl border border-ink/[0.08] bg-white px-4 py-3 text-sm"
              >
                <span>{REASON_LABEL[m.reason] ?? m.reason}</span>
                <span className="font-semibold">
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white px-4 text-sm font-semibold"
    >
      {label}
    </Link>
  );
}
