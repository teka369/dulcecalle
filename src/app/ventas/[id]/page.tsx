"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import { routeId } from "@/data/pwa/ids";
import {
  getSaleDetailWithOfflineFallback,
  type SaleDetailResult,
} from "@/data/pwa/offline-sales";
import { getPwaAuthSession } from "@/data/http/session";
import { useProductImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";

const kindLabel: Record<string, string> = {
  paid: "Pagada",
  partial: "Parcial",
  credit: "Fiada",
};

export default function VentaDetallePage() {
  const params = useParams();
  const id = routeId(params.id);
  const [data, setData] = useState<SaleDetailResult | null>(null);
  const [ready, setReady] = useState(false);
  const imageMap = useProductImageMap(getPwaAuthSession().businessId);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const row = await getSaleDetailWithOfflineFallback(id);
    setData(row);
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/ventas" className="text-sm text-ink/70">
          ← Ventas
        </Link>
        <p className="text-sm text-ink/60">No encontramos esa venta.</p>
      </div>
    );
  }

  const { sale, lines, remainingValue, returns } = data;
  const pending = sale.pending;
  const fromCache = data.source === "cache";
  const canReturn = remainingValue > 0 && !pending;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/ventas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold">Venta</h1>
          <p className="text-sm text-ink/60">
            {kindLabel[sale.paymentKind] ?? sale.paymentKind}
            {pending && (
              <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-semibold text-ink/70">
                ⏳ Pendiente de sincronización
              </span>
            )}
          </p>
        </div>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
          Total
        </p>
        <p className="mt-1 text-2xl font-semibold">{formatCop(sale.saleTotal)}</p>
        <p className="mt-2 text-sm text-ink/60">
          Recibido {formatCop(sale.amountReceived)} · Fiado {formatCop(sale.credit)}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink/60">Productos</h2>
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li
              key={l.id}
              className="rounded-2xl border border-ink/[0.08] bg-surface px-4 py-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <ProductThumbnail
                    secureUrl={imageMap.get(l.productId) ?? null}
                    alt={l.productName}
                    size="xs"
                  />
                  <span className="min-w-0 font-medium">{l.productName}</span>
                </span>
                <span className="shrink-0 font-semibold">{formatCop(l.lineTotal)}</span>
              </div>
              <p className="mt-1 text-xs text-ink/50">
                {l.qty} × {formatCop(l.unitPrice)}
                {l.returnedQty > 0
                  ? ` · Devuelto ${l.returnedQty} · Quedan ${l.remaining}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {canReturn && (
        <Link
          href={`/ventas/${sale.id}/devolver`}
          className="flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
        >
          Devolver
        </Link>
      )}

      {pending ? (
        <p className="text-xs text-ink/60">
          Las devoluciones estarán disponibles cuando la venta se sincronice.
        </p>
      ) : (
        !canReturn && (
          <p className="text-sm text-ink/60">Esta venta ya se devolvió.</p>
        )
      )}

      {fromCache && (
        <p className="text-xs text-ink/60">
          Sin conexión · mostrando venta guardada en este dispositivo.
        </p>
      )}

      {returns.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink/60">Devoluciones</h2>
          <ul className="flex flex-col gap-2">
            {returns.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border border-ink/[0.08] bg-surface px-4 py-3 text-sm"
              >
                <div className="flex justify-between gap-2">
                  <span>Devolución</span>
                  <span className="font-semibold text-danger">
                    −{formatCop(r.refundAmount + r.debtReduced)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink/50">
                  {r.refundAmount > 0
                    ? `Salieron ${formatCop(r.refundAmount)} de ${r.method}`
                    : "Sin salida de caja"}
                  {r.debtReduced > 0
                    ? ` · Deuda −${formatCop(r.debtReduced)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
