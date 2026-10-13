"use client";

import { useEffect, useMemo, useState } from "react";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { HeroPill } from "@/components/ui/HeroPill";
import { HeroSegmented } from "@/components/ui/HeroSegmented";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { PendingBadge } from "@/components/ui/StatusBadge";
import { formatCop } from "@/domain/money";
import type { RemoteCustomer } from "@/data/http/mappers";
import { listCachedCustomers } from "@/data/pwa/catalog";
import { listSalesWithOfflineFallback, type LocalSaleRow } from "@/data/pwa/offline-sales";
import { summarizeSales } from "@/components/sale/checkout";
import { bogotaKey, dayHeading, groupByDay, saleTime, ventasSheetState } from "@/components/sale/sales-list";

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

export default function VentasPage() {
  const [sales, setSales] = useState<LocalSaleRow[]>([]);
  const [customers, setCustomers] = useState<RemoteCustomer[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");

  function load() {
    setError(null);
    void listSalesWithOfflineFallback()
      .then((result) => {
        setSales(result.sales);
        setFromCache(result.source === "cache");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "No se pudo cargar.");
      })
      .finally(() => setReady(true));
  }

  useEffect(() => {
    load();
    void listCachedCustomers()
      .then(setCustomers)
      .catch(() => setCustomers([]));
  }, []);

  const customerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of customers) map.set(c.id, c.name);
    return map;
  }, [customers]);

  const [todayKey] = useState(() => bogotaKey(Date.now()));

  const filtered = useMemo(
    () => (filter === "all" ? sales : sales.filter((s) => s.paymentKind === filter)),
    [sales, filter],
  );
  const totals = useMemo(() => summarizeSales(filtered), [filtered]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const sheet = ventasSheetState({ ready, error, salesCount: sales.length, filteredCount: filtered.length });

  return (
    <div className="flex flex-col">
      <HeroBlock
        title="Ventas"
        action={<HeroPill href="/ventas/nueva" label="Nueva venta" />}
        offline={fromCache ? { text: "Sin conexión · mostrando ventas guardadas en este dispositivo." } : null}
        busy={!ready}
      >
        {error && sales.length === 0 ? null : (
          <>
            <HeroAmount
              className="mt-6"
              label="Total listado"
              value={formatCop(totals.ventas)}
              caption={`${totals.count} ${totals.count === 1 ? "venta" : "ventas"}`}
            />
            <p className="mt-2 text-sm tabular-nums text-on-hero-muted">
              Recibido {formatCop(totals.recibido)} · Fiado {formatCop(totals.fiado)}
            </p>
          </>
        )}
        <div className="mt-5">
          <HeroSegmented label="Filtrar por cobro" options={FILTERS} value={filter} onChange={setFilter} />
        </div>
      </HeroBlock>

      <Sheet>
        {sheet === "loading" ? (
          <SkeletonRows rows={4} />
        ) : sheet === "error" ? (
          <StateBlock
            kind="error"
            title={error ?? "No se pudo cargar."}
            action={
              <button
                type="button"
                onClick={load}
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
              >
                Reintentar
              </button>
            }
          />
        ) : sheet === "empty" ? (
          <StateBlock
            kind="empty"
            title={
              fromCache
                ? "Este historial todavía se está preparando para uso sin conexión, o no hay ventas de los últimos 90 días en este teléfono."
                : "Aún no hay ventas hoy."
            }
            action={
              <OfflineLink
                href="/ventas/nueva"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
              >
                Registrar venta
              </OfflineLink>
            }
          />
        ) : sheet === "filter-empty" ? (
          <StateBlock
            kind="empty"
            title="No hay ventas con ese filtro."
            action={
              <button
                type="button"
                onClick={() => setFilter("all")}
                className="min-h-11 text-sm font-semibold text-ink underline underline-offset-2"
              >
                Ver todas
              </button>
            }
          />
        ) : (
          groups.map((g) => (
            <section key={g.key} className="flex flex-col gap-2" aria-label={dayHeading(g.key, todayKey)}>
              <SectionHead title={dayHeading(g.key, todayKey)} />
              <RowGroup>
                {g.rows.map((s) => {
                  const name = s.customerId ? customerName.get(s.customerId) : null;
                  const time = saleTime(s.createdAt);
                  const who = name ?? "Venta";
                  const title = [time, [who, s.method].filter(Boolean).join(" · ")].filter(Boolean).join("  ");
                  const meta =
                    s.paymentKind === "partial"
                      ? `Recibió ${formatCop(s.amountReceived)} · Fía ${formatCop(s.credit)}`
                      : s.paymentKind === "credit"
                        ? `Fía ${formatCop(s.credit)}`
                        : undefined;
                  return (
                    <Row
                      key={s.id}
                      href={`/ventas/${s.id}`}
                      title={title}
                      meta={
                        <span className="flex flex-col gap-1">
                          {meta ? <span>{meta}</span> : null}
                          <span className="flex flex-wrap gap-1.5">
                            <Badge tone={kindTone(s.paymentKind)}>{kindLabel[s.paymentKind] ?? s.paymentKind}</Badge>
                            {s.pending && <PendingBadge />}
                          </span>
                        </span>
                      }
                      trailing={
                        <span className="text-base font-semibold tabular-nums text-ink">{formatCop(s.saleTotal)}</span>
                      }
                    />
                  );
                })}
              </RowGroup>
            </section>
          ))
        )}
        {error && sales.length > 0 && <StateBlock kind="error" title={error} />}
      </Sheet>
    </div>
  );
}
