"use client";

import { CustomerChrome, PortalError, PortalLoading } from "@/components/customer/CustomerChrome";
import { usePortalLedger } from "@/components/customer/usePortalLedger";
import { newestFirst, purchaseLabel, purchaseTone } from "@/components/customer/portal";
import { usePortalImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { formatCop } from "@/domain/money";
import { Badge } from "@/components/ui/Badge";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";

export default function CustomerPurchasesPage() {
  const { ledger, capturedAt, fromCache, error, reload } = usePortalLedger();
  const imageMap = usePortalImageMap();

  if (error) {
    return (
      <CustomerChrome title="Compras">
        <PortalError message={error} onRetry={reload} />
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Compras">
        <PortalLoading />
      </CustomerChrome>
    );
  }

  const sales = newestFirst(ledger.sales);

  return (
    <CustomerChrome title="Compras" capturedAt={fromCache ? capturedAt : null}>
      {sales.length === 0 ? (
        <StateBlock kind="empty" title="Todavía no hay compras a tu nombre." />
      ) : (
        <RowGroup label="Compras">
          {sales.map((s) => {
            const first = s.lines[0];
            const pid = first && typeof first.productId === "string" ? first.productId : null;
            return (
              <Row
                key={s.id}
                href={`/cliente/compras/${s.id}`}
                leading={
                  <ProductThumbnail
                    secureUrl={pid ? (imageMap.get(pid) ?? null) : null}
                    alt={first?.productName ?? "Compra"}
                    size="sm"
                    decorative
                  />
                }
                title={s.occurredOn}
                meta={<Badge tone={purchaseTone(s.credit, s.paymentKind)}>{purchaseLabel(s.credit, s.paymentKind)}</Badge>}
                trailing={<span className="text-[15px] font-semibold tabular-nums">{formatCop(s.saleTotal)}</span>}
              />
            );
          })}
        </RowGroup>
      )}
    </CustomerChrome>
  );
}
