"use client";

import { OfflineLink } from "@/components/shell/OfflineLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import { EntityBackLink, useEntityId } from "@/components/shell/entity-route";
import {
  getSaleDetailWithOfflineFallback,
  type SaleDetailResult,
} from "@/data/pwa/offline-sales";
import { getPwaAuthSession } from "@/data/http/session";
import { useProductImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { listCachedCustomers } from "@/data/pwa/catalog";

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

function saleDateLabel(occurredOn: string | null | undefined, createdAt: number | null | undefined): string {
  if (occurredOn) return occurredOn;
  if (createdAt) {
    const d = new Date(createdAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return "";
}

export default function VentaDetallePage() {
  const id = useEntityId();
  const [data, setData] = useState<SaleDetailResult | null>(null);
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const imageMap = useProductImageMap(getPwaAuthSession().businessId);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const row = await getSaleDetailWithOfflineFallback(id);
    setData(row);
    if (row?.sale.customerId) {
      try {
        const customers = await listCachedCustomers();
        const found = customers.find((c) => c.id === row.sale.customerId);
        setCustomerName(found?.name ?? null);
      } catch {
        setCustomerName(null);
      }
    } else {
      setCustomerName(null);
    }
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
        <EntityBackLink href="/ventas" className="text-sm text-ink-muted">
          ← Ventas
        </EntityBackLink>
        <p className="text-sm text-ink-muted">No encontramos esa venta.</p>
      </div>
    );
  }

  const { sale, lines, remainingValue, returns } = data;
  const pending = sale.pending;
  const fromCache = data.source === "cache";
  const canReturn = remainingValue > 0;
  const date = saleDateLabel(sale.occurredOn, sale.createdAt);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <EntityBackLink
          href="/ventas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </EntityBackLink>
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold">Venta</h1>
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <Badge tone={kindTone(sale.paymentKind)}>
              {kindLabel[sale.paymentKind] ?? sale.paymentKind}
            </Badge>
            {pending && (
              <Badge tone="warning">⏳ Pendiente de sincronización</Badge>
            )}
          </p>
        </div>
      </header>

      {/* Resumen — saleTotal ≠ amountReceived ≠ credit */}
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          Total
        </p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {formatCop(sale.saleTotal)}
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Recibido {formatCop(sale.amountReceived)} · Fiado{" "}
          {formatCop(sale.credit)}
        </p>
        {(date || sale.method || customerName) && (
          <p className="mt-2 text-xs text-ink-muted">
            {[date, customerName, sale.method].filter(Boolean).join(" · ")}
          </p>
        )}
        {sale.note ? (
          <p className="mt-2 text-sm text-ink">
            <span className="text-ink-muted">Nota · </span>
            {sale.note}
          </p>
        ) : null}
      </Card>

      {/* Líneas */}
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
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatCop(l.lineTotal)}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {l.qty} × {formatCop(l.unitPrice)}
                {l.unitCost != null && l.unitCost > 0
                  ? ` · Costo ${formatCop(l.unitCost)}`
                  : ""}
                {l.returnedQty > 0
                  ? ` · Devuelto ${l.returnedQty} · Quedan ${l.remaining}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* CTA Devolver if applicable */}
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
          Devolución pendiente de confirmación. El inventario no sube hasta que
          el servidor la acepte.
        </p>
      )}

      {pending && canReturn && (
        <p className="text-xs text-ink-muted">
          La venta se sincroniza primero. Puedes dejar la devolución lista en
          este dispositivo.
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
          <h2 className="mb-2 text-sm font-semibold text-ink-muted">
            Devoluciones
          </h2>
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
