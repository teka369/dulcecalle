"use client";

import { OfflineLink } from "@/components/shell/OfflineLink";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { SegmentedMetrics } from "@/components/ui/SegmentedMetrics";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { PendingBadge } from "@/components/ui/StatusBadge";
import { dayHeading, saleDayKey, saleTime } from "@/components/sale/sales-list";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import { useEntityId } from "@/components/shell/entity-route";
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
      <div className="flex flex-col">
        <SkeletonHero title="Venta" />
        <Sheet>
          <SkeletonRows rows={3} />
        </Sheet>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col">
        <HeroBlock size="medium" back={{ href: "/ventas", label: "Volver a Ventas", entity: true }} title="Venta">
          <StateBlock kind="empty" onHero title="No encontramos esa venta." />
        </HeroBlock>
      </div>
    );
  }

  const { sale, lines, remainingValue, returns } = data;
  const pending = sale.pending;
  const fromCache = data.source === "cache";
  const canReturn = remainingValue > 0;
  const day = saleDayKey(sale);
  const time = saleTime(sale.createdAt);
  const when = [day ? dayHeading(day, "") : null, time].filter(Boolean).join(", ");
  const dot = sale.paymentKind === "paid" ? "bg-ok" : sale.paymentKind === "partial" ? "bg-warning" : "bg-info";

  return (
    <div className="flex flex-col">
      <HeroBlock
        size="medium"
        back={{ href: "/ventas", label: "Volver a Ventas", entity: true }}
        title="Venta"
        subtitle={when || undefined}
        action={canReturn ? <HeroPill href={`/ventas/${sale.id}/devolver`} label="Devolver" /> : undefined}
        offline={fromCache ? { text: "Sin conexión · mostrando venta guardada en este dispositivo." } : null}
      >
        <p className="mt-5 break-all text-5xl font-semibold leading-none tracking-tight tabular-nums max-[359px]:text-4xl">
          {formatCop(sale.saleTotal)}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-on-hero-muted">
          <span className={`size-2 rounded-full ${dot}`} aria-hidden />
          <span className="font-semibold text-on-hero">{kindLabel[sale.paymentKind] ?? sale.paymentKind}</span>
          {customerName ? (
            sale.customerId ? (
              <OfflineLink href={`/clientes/${sale.customerId}`} className="underline underline-offset-2">
                {customerName}
              </OfflineLink>
            ) : (
              <span>{customerName}</span>
            )
          ) : null}
        </p>
        {pending && (
          <p className="mt-3">
            <PendingBadge label="Pendiente de sincronización" />
          </p>
        )}
      </HeroBlock>

      <Sheet>
        {/* saleTotal ≠ amountReceived ≠ credit — each in its own cell */}
        <SegmentedMetrics
          label="Cobro de la venta"
          items={[
            { icon: "cash", label: "Recibido", value: formatCop(sale.amountReceived), tone: "ok" },
            { icon: "users", label: "Fiado", value: formatCop(sale.credit), tone: sale.credit > 0 ? "accent" : "neutral" },
            { icon: "bag", label: "Método", value: sale.method ?? "—" },
          ]}
        />

        {!canReturn && !data.returnPending && (
          <p role="status" className="rounded-[var(--r-lg)] bg-info-soft px-3 py-2.5 text-sm text-info">
            Esta venta ya se devolvió.
          </p>
        )}
        {data.returnPending && (
          <p className="rounded-[var(--r-lg)] bg-warning-soft px-3 py-2.5 text-sm text-warning">
            Devolución pendiente de confirmación. El inventario no sube hasta que el servidor la acepte.
          </p>
        )}
        {pending && canReturn && (
          <p className="text-xs text-ink-muted">
            La venta se sincroniza primero. Puedes dejar la devolución lista en este dispositivo.
          </p>
        )}

        <section className="flex flex-col gap-2">
          <SectionHead title="Productos" />
          <RowGroup>
            {lines.map((l) => (
              <Row
                key={l.id}
                leading={<ProductThumbnail secureUrl={imageMap.get(l.productId) ?? null} alt={l.productName} size="sm" />}
                title={l.productName}
                meta={
                  `${l.qty} × ${formatCop(l.unitPrice)}` +
                  (l.unitCost != null && l.unitCost > 0 ? ` · Costo ${formatCop(l.unitCost)}` : "") +
                  (l.returnedQty > 0 ? ` · Devuelto ${l.returnedQty} · Quedan ${l.remaining}` : "")
                }
                trailing={<span className="text-sm font-semibold tabular-nums text-ink">{formatCop(l.lineTotal)}</span>}
              />
            ))}
          </RowGroup>
        </section>

        {returns.length > 0 && (
          <section className="flex flex-col gap-2">
            <SectionHead title="Devoluciones" />
            <RowGroup>
              {returns.map((r) => (
                <Row
                  key={r.id}
                  title={`Devolución · ${dayHeading(r.occurredOn || saleDayKey(r), "")}`}
                  meta={
                    (r.refundAmount > 0 ? `Reembolso ${formatCop(r.refundAmount)}${r.method ? ` de ${r.method}` : ""}` : "Sin salida de caja") +
                    (r.debtReduced > 0 ? ` · Baja deuda ${formatCop(r.debtReduced)}` : "")
                  }
                  trailing={
                    <span className="text-sm font-semibold tabular-nums text-danger">
                      −{formatCop(r.refundAmount + r.debtReduced)}
                    </span>
                  }
                />
              ))}
            </RowGroup>
          </section>
        )}

        {sale.note ? (
          <section className="flex flex-col gap-2">
            <SectionHead title="Nota" />
            <RowGroupNote>{sale.note}</RowGroupNote>
          </section>
        ) : null}
      </Sheet>
    </div>
  );
}
