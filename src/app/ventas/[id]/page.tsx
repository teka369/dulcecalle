"use client";

import Link from "next/link";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
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

function kindTone(kind: string): BadgeTone {
  if (kind === "paid") return "ok";
  if (kind === "partial") return "warning";
  return "info";
}

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
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/ventas" className="text-sm text-ink-muted">
          ← Ventas
        </Link>
        <p className="text-sm text-ink-muted">No encontramos esa venta.</p>
      </div>
    );
  }

  const { sale, lines, remainingValue, returns } = data;
  const pending = sale.pending;
  const fromCache = data.source === "cache";
  const canReturn = remainingValue > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/ventas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold">Venta</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <Badge tone={kindTone(sale.paymentKind)}>
              {kindLabel[sale.paymentKind] ?? sale.paymentKind}
            </Badge>
            {pending && <Badge tone="warning">⏳ Pendiente de sincronización</Badge>}
          </p>
        </div>
      </header>

      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Total
        </p>
        <p className="mt-1 text-2xl font-semibold">{formatCop(sale.saleTotal)}</p>
        <p className="mt-2 text-sm text-ink-muted">
          Recibido {formatCop(sale.amountReceived)} · Fiado {formatCop(sale.credit)}
        </p>
      </Card>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">Productos</h2>
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li
              key={l.id}
              className="rounded-[var(--r-lg)] border border-border bg-surface px-4 py-3 text-sm shadow-[var(--shadow-sm)]"
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
              <p className="mt-1 text-xs text-ink-muted">
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
        <OfflineLink
          href={`/ventas/${sale.id}/devolver`}
          className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
        >
          Devolver
        </OfflineLink>
      )}

      {data.returnPending && (
        <p className="text-xs text-ink-muted">
          Devolución pendiente de confirmación. El inventario no sube hasta que el servidor la acepte.
        </p>
      )}

      {pending && canReturn && (
        <p className="text-xs text-ink-muted">
          La venta se sincroniza primero. Puedes dejar la devolución lista en este dispositivo.
        </p>
      )}

      {!canReturn && !data.returnPending && (
        <p className="text-sm text-ink-muted">Esta venta ya se devolvió.</p>
      )}

      {fromCache && (
        <p className="text-xs text-ink-muted">
          Sin conexión · mostrando venta guardada en este dispositivo.
        </p>
      )}

      {returns.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">Devoluciones</h2>
          <ul className="flex flex-col gap-2">
            {returns.map((r) => (
              <li
                key={r.id}
                className="rounded-[var(--r-lg)] border border-border bg-surface px-4 py-3 text-sm shadow-[var(--shadow-sm)]"
              >
                <div className="flex justify-between gap-2">
                  <span>Devolución</span>
                  <span className="font-semibold text-danger">
                    −{formatCop(r.refundAmount + r.debtReduced)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
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
