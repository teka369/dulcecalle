"use client";

import { useEffect, useMemo, useState } from "react";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { PageHeader } from "@/components/ui/PageHeader";
import { Spinner } from "@/components/ui/Spinner";
import { formatCop } from "@/domain/money";
import type { RemoteCustomer } from "@/data/http/mappers";
import { listCachedCustomers } from "@/data/pwa/catalog";
import { listSalesWithOfflineFallback, type LocalSaleRow } from "@/data/pwa/offline-sales";

const kindLabel: Record<string, string> = {
  paid: "Pagada",
  partial: "Parcial",
  credit: "Fiada",
};

type FilterKind = "all" | "paid" | "partial" | "credit";

const FILTERS: Array<{ id: FilterKind; label: string }> = [
  { id: "all", label: "Todas" },
  { id: "paid", label: "Pagadas" },
  { id: "partial", label: "Parcial" },
  { id: "credit", label: "Fiadas" },
];

function kindTone(kind: string): BadgeTone {
  if (kind === "paid") return "ok";
  if (kind === "partial") return "warning";
  return "info";
}

function todayLocalKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function saleDateLabel(sale: LocalSaleRow): string {
  if (sale.occurredOn) return sale.occurredOn;
  if (sale.createdAt) {
    const d = new Date(sale.createdAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return "";
}

export default function VentasPage() {
  const [sales, setSales] = useState<LocalSaleRow[]>([]);
  const [customers, setCustomers] = useState<RemoteCustomer[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");

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
    void listCachedCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);

  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const todayKey = useMemo(() => todayLocalKey(), []);

  const todayCount = useMemo(
    () => sales.filter((s) => saleDateLabel(s) === todayKey).length,
    [sales, todayKey],
  );

  const filtered = useMemo(() => {
    if (filter === "all") return sales;
    return sales.filter((s) => s.paymentKind === filter);
  }, [sales, filter]);

  const subtitle = !ready
    ? "Cargando…"
    : sales.length === 0
      ? "Sin ventas aún"
      : todayCount > 0
        ? `${sales.length} ventas · ${todayCount} hoy`
        : `${sales.length} ventas`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Ventas" subtitle={subtitle}>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filtrar por cobro">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              type="button"
              variant={filter === f.id ? "primary" : "secondary"}
              onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-full px-4 ${
                filter === f.id
                  ? "bg-primary text-ink hover:opacity-[0.92]"
                  : "text-ink-muted"
              }`}
              aria-pressed={filter === f.id}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </PageHeader>

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
          action={
            <OfflineLink
              href="/ventas/nueva"
              className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
            >
              + Nueva venta
            </OfflineLink>
          }
        />
      ) : filtered.length === 0 ? (
        <Empty title="No hay ventas con ese filtro." />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((s) => {
            const name = s.customerId ? customerName.get(s.customerId) : null;
            const date = saleDateLabel(s);
            const secondary: string[] = [];
            if (date) secondary.push(date);
            if (name) secondary.push(name);
            if (s.method) secondary.push(s.method);
            return (
              <li key={s.id}>
                <OfflineLink
                  href={`/ventas/${s.id}`}
                  className="block rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge tone={kindTone(s.paymentKind)}>
                        {kindLabel[s.paymentKind] ?? s.paymentKind}
                      </Badge>
                      {s.pending && <Badge tone="warning">⏳ Pendiente</Badge>}
                    </span>
                    <span className="shrink-0 text-base font-semibold tabular-nums">
                      {formatCop(s.saleTotal)}
                    </span>
                  </div>
                  {secondary.length > 0 && (
                    <p className="mt-1 text-xs text-ink-muted">
                      {secondary.join(" · ")}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-ink-muted">
                    Recibido {formatCop(s.amountReceived)} · Fiado{" "}
                    {formatCop(s.credit)}
                  </p>
                </OfflineLink>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
