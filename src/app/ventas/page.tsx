"use client";

import { useEffect, useState } from "react";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { Spinner } from "@/components/ui/Spinner";
import { formatCop } from "@/domain/money";
import { listSalesWithOfflineFallback, type LocalSaleRow } from "@/data/pwa/offline-sales";

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

export default function VentasPage() {
  const [sales, setSales] = useState<LocalSaleRow[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void listSalesWithOfflineFallback()
      .then((result) => {
        setSales(result.sales);
        setFromCache(result.source === "cache");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "No se pudo cargar.");
      })
      .finally(() => setReady(true));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-[22px] font-semibold">Ventas</h1>
        <OfflineLink
          href="/ventas/nueva"
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-3 text-sm font-semibold text-cta-fg"
        >
          + Nueva venta
        </OfflineLink>
      </header>

      {error && <p className="text-sm text-danger">{error}</p>}

      {fromCache && sales.length > 0 && (
        <p className="text-xs text-ink-muted">
          Sin conexión · mostrando ventas guardadas en este dispositivo.
        </p>
      )}

      {!ready && !error ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : sales.length === 0 && !error ? (
        <Empty
          title={
            fromCache
              ? "No hay ventas guardadas en este dispositivo."
              : "Aún no hay ventas hoy."
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {sales.map((s) => (
            <li key={s.id}>
              <OfflineLink
                href={`/ventas/${s.id}`}
                className="block rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <Badge tone={kindTone(s.paymentKind)}>
                      {kindLabel[s.paymentKind] ?? s.paymentKind}
                    </Badge>
                    {s.pending && <Badge tone="warning">⏳ Pendiente</Badge>}
                  </span>
                  <span className="text-sm font-semibold">
                    {formatCop(s.saleTotal)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Recibido {formatCop(s.amountReceived)} · Fiado{" "}
                  {formatCop(s.credit)}
                </p>
              </OfflineLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
