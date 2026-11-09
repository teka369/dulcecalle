"use client";

import { dmy } from "@/components/inventory/inventory";
import { useParams } from "next/navigation";
import { CustomerChrome, PortalError, PortalLoading } from "@/components/customer/CustomerChrome";
import { usePortalLedger } from "@/components/customer/usePortalLedger";
import { purchaseLabel } from "@/components/customer/portal";
import { findCustomerSale } from "@/data/pwa/customer-portal";
import { usePortalImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { routeId } from "@/data/pwa/ids";
import { formatCop } from "@/domain/money";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { SegmentedMetrics } from "@/components/ui/SegmentedMetrics";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";

const BACK = { href: "/cliente/compras", label: "Volver a Compras" };

export default function CustomerPurchaseDetailPage() {
  const params = useParams();
  const id = routeId(params.id);
  const { ledger, capturedAt, fromCache, error, reload } = usePortalLedger();
  const imageMap = usePortalImageMap();

  if (error) {
    return (
      <CustomerChrome title="Compra" back={BACK}>
        <PortalError message={error} onRetry={reload} />
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Compra" back={BACK}>
        <PortalLoading />
      </CustomerChrome>
    );
  }

  const sale = id ? findCustomerSale(ledger, id) : undefined;
  if (!sale) {
    return (
      <CustomerChrome title="Compra" back={BACK}>
        <StateBlock kind="empty" title="No encontramos esa compra." />
      </CustomerChrome>
    );
  }

  return (
    <CustomerChrome
      title="Compra"
      back={BACK}
      capturedAt={fromCache ? capturedAt : null}
      subtitle={dmy(sale.occurredOn)}
      hero={
        <div className="mt-4">
          <HeroAmount
            label={purchaseLabel(sale.credit, sale.paymentKind, sale.openBalance, sale.reversal)}
            value={formatCop(sale.saleTotal)}
            tone={!sale.reversal && (sale.openBalance ?? sale.credit) > 0 ? "danger" : "ok"}
          />
        </div>
      }
    >
      <SegmentedMetrics
        label="Pago de esta compra"
        items={[
          { icon: "cash", label: "Pagaste", value: formatCop(sale.amountReceived), tone: "ok" },
          { icon: "clock", label: "Quedó a crédito", value: formatCop(sale.credit), tone: sale.credit > 0 ? "danger" : "neutral" },
          { icon: "check", label: "Método", value: sale.method ?? "—" },
        ]}
      />
      {sale.credit > 0 && typeof sale.openBalance === "number" ? (
        <section className="flex flex-col gap-2">
          <SectionHead title="Pagos de esta compra" />
          <RowGroup label="Pagos de esta compra">
            <Row
              title="Abonos aplicados"
              trailing={<span className="font-semibold tabular-nums">{formatCop(sale.credit - sale.openBalance)}</span>}
            />
            <Row title="Te falta" trailing={<span className="font-semibold tabular-nums">{formatCop(sale.openBalance)}</span>} />
            {(sale.allocations ?? []).filter((a) => a.amount > 0).length === 0 ? (
              <Row title="Aún no hay abonos a esta compra." />
            ) : (
              (sale.allocations ?? [])
                .filter((a) => a.amount > 0)
                .map((a) => (
                  <Row
                    key={`${a.sourceType}-${a.sourceId}`}
                    title={a.sourceType === "sale_return" ? "Devolución" : "Abono"}
                    meta={dmy(typeof a.createdAt === "number" ? new Date(a.createdAt).toISOString().slice(0, 10) : String(a.createdAt).slice(0, 10))}
                    trailing={<span className="tabular-nums">{formatCop(a.amount)}</span>}
                  />
                ))
            )}
          </RowGroup>
        </section>
      ) : null}
      <section className="flex flex-col gap-2">
        <SectionHead title="Productos" />
        <RowGroup label="Productos">
          {sale.lines.map((l) => (
            <Row
              key={l.id}
              leading={
                <ProductThumbnail
                  secureUrl={typeof l.productId === "string" ? (imageMap.get(l.productId) ?? null) : null}
                  alt={l.productName}
                  size="sm"
                  decorative
                />
              }
              title={l.productName}
              meta={`${l.qty} × ${formatCop(l.unitPrice)}`}
              trailing={<span className="font-semibold tabular-nums">{formatCop(l.lineTotal)}</span>}
            />
          ))}
        </RowGroup>
      </section>
      {sale.returns.length > 0 ? (
        <section className="flex flex-col gap-2">
          <SectionHead title="Devoluciones" />
          <RowGroup label="Devoluciones">
            {sale.returns.map((r) => (
              <Row
                key={r.id}
                title={dmy(r.occurredOn)}
                meta={[
                  r.lines.map((l) => `${l.qty} × ${formatCop(l.unitPrice)}`).join(", "),
                  r.debtReduced > 0 ? `Bajó deuda ${formatCop(r.debtReduced)}` : null,
                  r.refundAmount > 0 ? `Reembolso ${formatCop(r.refundAmount)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </RowGroup>
        </section>
      ) : null}
    </CustomerChrome>
  );
}
