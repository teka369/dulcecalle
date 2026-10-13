"use client";

import { useState } from "react";
import { formatCop } from "@/domain/money";
import { ProductThumbnail } from "./ProductThumbnail";

export type ProductTileProps = {
  name: string;
  imageUrl: string | null;
  /** Price for this sale (custom or catalog). */
  price: number;
  catalogPrice: number;
  stock: number;
  lowStockAt: number;
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
  onPriceChange: (raw: string) => void;
};

/**
 * Sale tile: tap the tile to add one (stock-capped by the caller), −/+
 * stepper once in the cart, «Editar precio» keeps the per-sale override.
 */
export function ProductTile({
  name,
  imageUrl,
  price,
  catalogPrice,
  stock,
  lowStockAt,
  qty,
  onAdd,
  onRemove,
  onPriceChange,
}: ProductTileProps) {
  const [editing, setEditing] = useState(false);
  const soldOut = stock <= 0;
  const low = !soldOut && stock <= lowStockAt;
  const custom = price !== catalogPrice;
  return (
    <article
      className={`relative flex flex-col rounded-[var(--r-lg)] border bg-surface p-2.5 ${
        qty > 0 ? "border-2 border-cta" : "border-border"
      }`}
    >
      <button
        type="button"
        onClick={onAdd}
        disabled={soldOut}
        aria-label={soldOut ? `${name}, agotado` : `Agregar ${name}`}
        className="flex flex-col items-start gap-2 text-left disabled:opacity-60"
      >
        <ProductThumbnail secureUrl={imageUrl} alt={name} size="md" />
        <span className="line-clamp-2 min-h-10 text-sm font-medium text-ink">{name}</span>
        <span className="text-base font-semibold tabular-nums text-ink">{formatCop(price)}</span>
        <span className={`text-xs ${low ? "font-semibold text-warning" : "text-ink-muted"}`}>
          {soldOut ? "Agotado" : `Quedan ${stock}`}
        </span>
      </button>
      {custom && <span className="text-[11px] text-ink-muted">Normal {formatCop(catalogPrice)}</span>}

      {editing ? (
        <label className="mt-2 block text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Precio de esta venta
          <input
            inputMode="numeric"
            aria-label={`Precio de ${name}`}
            value={String(price)}
            onChange={(e) => onPriceChange(e.target.value)}
            onBlur={() => setEditing(false)}
            autoFocus
            className="mt-1 h-11 w-full rounded-[var(--r-md)] border border-border bg-bg px-2 text-sm font-semibold normal-case text-ink"
          />
        </label>
      ) : (
        !soldOut && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-1 min-h-11 self-start text-xs font-semibold text-ink underline underline-offset-2"
          >
            Editar precio
          </button>
        )
      )}

      {qty > 0 && (
        <div className="mt-auto flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Quitar uno de ${name}`}
            className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-lg font-semibold text-ink"
          >
            −
          </button>
          <span className="min-w-8 rounded-full bg-cta px-2 py-1 text-center text-sm font-semibold tabular-nums text-cta-fg" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Agregar uno de ${name}`}
            className="flex size-11 items-center justify-center rounded-full bg-surface-2 text-lg font-semibold text-ink"
          >
            +
          </button>
        </div>
      )}
    </article>
  );
}
