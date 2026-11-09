"use client";

import { errorText } from "@/domain/ux/user-message";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { SegmentedMetrics } from "@/components/ui/SegmentedMetrics";
import { StateBlock } from "@/components/ui/StateBlock";
import { ListErrorState } from "@/components/ui/ListErrorState";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { PendingBadge } from "@/components/ui/StatusBadge";
import { SaleSyncBlock } from "@/components/sale/SaleSyncBlock";
import { dayHeading, saleCustomerLabel, saleDayKey, saleMethodLabel, saleTime } from "@/components/sale/sales-list";
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
import { useOnline } from "@/components/shell/use-online";
import { useIsOwner } from "@/components/reversal/use-is-owner";
import { ReversalSheet } from "@/components/reversal/ReversalSheet";
import { getPwaApi } from "@/data/pwa/api";
import { localDateKey } from "@/domain/cash/day";
import {
  OFFLINE_REVERSAL_TEXT,
  canUndoSale,
  reasonLabel,
  reversalActionState,
} from "@/domain/reversal";

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const imageMap = useProductImageMap(getPwaAuthSession().businessId);
  const online = useOnline();
  const isOwner = useIsOwner(online);
  const [voidSheet, setVoidSheet] = useState<null | "manual" | "undo">(null);
  const [voidDone, setVoidDone] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    setLoadError(null);
    try {
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
    } catch (e: unknown) {
      setLoadError(errorText(e, ""));
    } finally {
      setReady(true);
    }
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

  if (loadError !== null) {
    return (
      <div className="flex flex-col">
        <HeroBlock size="medium" back={{ href: "/ventas", label: "Volver a Ventas", entity: true }} title="Venta" />
        <Sheet>
          <ListErrorState
            message={loadError}
            online={typeof navigator === "undefined" || navigator.onLine}
            onRetry={() => {
              setReady(false);
              void load();
            }}
          />
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
  const reversal = sale.reversal ?? null;
  // C07 G8 — a voided sale has no more actions (no Devolver, no Anular).
  const canReturn = remainingValue > 0 && !reversal;
  const voidState = pending || fromCache ? (isOwner === true && !reversal ? "disabled" : "hidden") : reversalActionState({ isOwner, online, reversed: !!reversal });
  const undo = canUndoSale({ createdAt: sale.createdAt, now, isOwner, online, reversed: !!reversal, pending });
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
        <p
          className={`mt-5 break-all text-5xl font-semibold leading-none tracking-tight tabular-nums max-[359px]:text-4xl ${reversal ? "line-through" : ""}`}
          aria-label={reversal ? `${formatCop(sale.saleTotal)}, anulada` : undefined}
        >
          {formatCop(sale.saleTotal)}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-on-hero-muted">
          <span className={`size-2 rounded-full ${dot}`} aria-hidden />
          <span className="font-semibold text-on-hero">{kindLabel[sale.paymentKind] ?? sale.paymentKind}</span>
          {sale.customerId ? (
            <OfflineLink href={`/clientes/${sale.customerId}`} className="underline underline-offset-2">
              {saleCustomerLabel(sale.customerId, customerName)}
            </OfflineLink>
          ) : (
            <span>{saleCustomerLabel(null, customerName)}</span>
          )}
        </p>
        {pending && sale.syncState !== "rejected" && (
          <p className="mt-3">
            <PendingBadge label="Pendiente de sincronización" />
          </p>
        )}
      </HeroBlock>

      <Sheet>
        <SaleSyncBlock sale={sale} />
        {reversal ? (
          <p role="status" className="rounded-[var(--r-lg)] bg-surface-2 px-3 py-2.5 text-sm text-ink">
            <span className="font-semibold">Anulada</span>
            {` el ${new Date(reversal.createdAt).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
            {` · Motivo: ${reasonLabel(reversal.reasonCode)}`}
            {reversal.reasonText ? ` (${reversal.reasonText})` : ""}
            {reversal.number ? ` · Comprobante ${reversal.number}` : ""}
          </p>
        ) : null}
        {voidDone ? (
          <p role="status" className="rounded-[var(--r-lg)] bg-ok-soft px-3 py-2.5 text-sm text-ink">
            {`Venta anulada · ${voidDone}`}
          </p>
        ) : null}
        {/* saleTotal ≠ amountReceived ≠ credit — each in its own cell */}
        <SegmentedMetrics
          label="Cobro de la venta"
          items={[
            { icon: "cash", label: "Recibido", value: formatCop(sale.amountReceived), tone: "ok" },
            { icon: "users", label: "Fiado", value: formatCop(sale.credit), tone: sale.credit > 0 ? "accent" : "neutral" },
            { icon: "bag", label: "Método", value: saleMethodLabel(sale.paymentKind, sale.method) },
          ]}
        />

        {sale.credit > 0 && typeof sale.openBalance === "number" ? (
          <section className="flex flex-col gap-2" aria-labelledby="pagos-compra">
            <div id="pagos-compra" className="flex items-center justify-between">
              <SectionHead title="Pagos de esta compra" />
              <span
                className={`rounded-[var(--r-pill)] px-2 py-1 text-xs font-semibold ${sale.openBalance > 0 ? "bg-warning-soft" : "bg-ok-soft"}`}
              >
                {sale.openBalance > 0 ? `Pendiente ${formatCop(sale.openBalance)}` : "Saldada"}
              </span>
            </div>
            <RowGroup>
              <Row title="En la venta" trailing={<span className="tabular-nums">{formatCop(sale.amountReceived)}</span>} />
              <Row
                title="Abonos"
                trailing={
                  <span className="tabular-nums">
                    {formatCop((sale.appliedFrom ?? []).filter((a) => a.sourceType === "payment" && a.mode !== "credit_apply").reduce((s, a) => s + a.amount, 0))}
                  </span>
                }
              />
              <Row
                title="Saldo a favor"
                trailing={
                  <span className="tabular-nums">
                    {formatCop((sale.appliedFrom ?? []).filter((a) => a.mode === "credit_apply").reduce((s, a) => s + a.amount, 0))}
                  </span>
                }
              />
              <Row title="Pendiente" trailing={<span className="font-semibold tabular-nums">{formatCop(sale.openBalance)}</span>} />
            </RowGroup>
            {sale.openBalance > 0 && sale.customerId ? (
              <OfflineLink
                href={`/clientes/${sale.customerId}/abono?compra=${sale.id}`}
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-pill)] border border-border bg-surface px-4 text-sm font-semibold text-ink"
              >
                Registrar abono a esta compra
              </OfflineLink>
            ) : null}
          </section>
        ) : null}

        {voidState !== "hidden" ? (
          <section className="flex flex-col gap-2" aria-label="Anular venta">
            {undo && voidState === "enabled" ? (
              <button
                type="button"
                onClick={() => setVoidSheet("undo")}
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-pill)] border border-border bg-surface px-4 text-sm font-semibold text-ink"
              >
                Deshacer venta
              </button>
            ) : null}
            <button
              type="button"
              aria-disabled={voidState === "disabled" ? "true" : undefined}
              onClick={() => {
                if (voidState === "enabled") setVoidSheet("manual");
              }}
              className={`inline-flex min-h-11 items-center justify-center rounded-[var(--r-pill)] px-4 text-sm font-semibold text-danger ${voidState === "disabled" ? "opacity-50" : ""}`}
            >
              Anular venta
            </button>
            {voidState === "disabled" ? (
              <p className="text-xs text-ink-muted">{OFFLINE_REVERSAL_TEXT}</p>
            ) : (
              <p className="text-xs text-ink-muted">
                Anular: la venta no debió existir. Devolver: el cliente regresa algo.
              </p>
            )}
          </section>
        ) : null}
        {voidSheet ? (
          <ReversalSheet
            title="Anular venta"
            kind="sale"
            ctaLabel="Anular venta"
            firstName={customerName ? customerName.split(" ")[0] ?? null : null}
            occurredOn={sale.occurredOn}
            today={localDateKey()}
            defaultReason={voidSheet === "undo" ? "error_digitacion" : undefined}
            returnHref={`/ventas/${sale.id}/devolver`}
            preview={(body) => getPwaApi().reversals.voidSale(sale.id, body, { dryRun: true })}
            submit={(body, requestId) =>
              getPwaApi().reversals.voidSale(sale.id, { ...body, source: voidSheet === "undo" ? "undo" : "manual" }, { requestId })
            }
            onDone={(r) => {
              setVoidDone(r.number ?? "");
              void load();
            }}
            onClose={() => setVoidSheet(null)}
          />
        ) : null}

        {!canReturn && !reversal && !data.returnPending && (
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
