"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerChrome, CustomerCacheNotice } from "@/components/customer/CustomerChrome";
import type { CustomerLedger } from "@/data/http/customer-api";
import { loadCachedCustomerLedger } from "@/data/pwa/customer-ledger-cache";
import { usePortalImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { formatCop } from "@/domain/money";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { Spinner } from "@/components/ui/Spinner";

function purchaseLabel(credit: number, paymentKind: string): string {
  if (credit > 0) {
    return paymentKind === "partial" ? "Venta parcial" : "Fiado";
  }
  return "Compra";
}

function purchaseTone(credit: number, paymentKind: string): BadgeTone {
  if (credit <= 0) return "ok";
  if (paymentKind === "partial") return "warning";
  return "info";
}

export default function CustomerPurchasesPage() {
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageMap = usePortalImageMap();

  useEffect(() => {
    void loadCachedCustomerLedger()
      .then((result) => {
        setLedger(result.ledger);
        setCapturedAt(result.capturedAt);
        setFromCache(result.source === "cache");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "No se pudo cargar.");
      });
  }, []);

  if (error) {
    return (
      <CustomerChrome title="Compras">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Compras">
        <div className="flex flex-col items-center gap-2 py-10">
          <Spinner />
          <p className="text-sm text-ink-muted">Cargando…</p>
        </div>
      </CustomerChrome>
    );
  }

  const sales = [...ledger.sales].sort(
    (a, b) =>
      (typeof b.createdAt === "number" ? b.createdAt : Date.parse(String(b.createdAt))) -
      (typeof a.createdAt === "number" ? a.createdAt : Date.parse(String(a.createdAt))),
  );

  return (
    <CustomerChrome title="Compras">
      {fromCache && capturedAt != null && (
        <CustomerCacheNotice capturedAt={capturedAt} />
      )}
      {sales.length === 0 ? (
        <Empty title="Todavía no hay compras a tu nombre." />
      ) : (
        <ul className="flex flex-col gap-2">
          {sales.map((s) => (
            <li key={s.id}>
              <Link
                href={`/cliente/compras/${s.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <ProductThumbnail
                    secureUrl={(() => {
                      const first = s.lines[0];
                      const pid =
                        first && typeof first.productId === "string"
                          ? first.productId
                          : null;
                      return pid ? (imageMap.get(pid) ?? null) : null;
                    })()}
                    alt={s.lines[0]?.productName ?? "Compra"}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={purchaseTone(s.credit, s.paymentKind)}>
                        {purchaseLabel(s.credit, s.paymentKind)}
                      </Badge>
                    </span>
                    <span className="mt-1 block text-xs text-ink-muted">
                      {s.occurredOn}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatCop(s.saleTotal)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CustomerChrome>
  );
}
