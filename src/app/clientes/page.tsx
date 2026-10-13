"use client";

import { OfflineLink } from "@/components/shell/OfflineLink";
import { useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import { getPendingCustomerIds } from "@/data/pwa/offline-catalog";
import { useCustomers } from "@/store/customerStore";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { HeroPill } from "@/components/ui/HeroPill";
import { HeroSearch } from "@/components/ui/HeroSearch";
import { HeroSegmented } from "@/components/ui/HeroSegmented";
import { Sheet } from "@/components/ui/Sheet";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { PendingBadge } from "@/components/ui/StatusBadge";
import { Badge } from "@/components/ui/Badge";
import { filterCustomers, porCobrar, type ClientesSegment } from "@/components/customers/clientes";

export default function ClientesPage() {
  const { customers, refresh, loading } = useCustomers();
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<ClientesSegment>("todos");
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  useEffect(() => {
    void refresh();
    void getPendingCustomerIds().then(setPendingIds);
  }, [refresh]);

  const summary = useMemo(() => porCobrar(customers), [customers]);
  const filtered = useMemo(() => filterCustomers(customers, query, segment), [customers, query, segment]);
  const searching = query.trim().length > 0;

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="tall"
        title="Clientes"
        action={<HeroPill label="Agregar cliente" href="/clientes/nuevo" />}
      >
        <div className="mt-5">
          <HeroAmount
            label="Por cobrar"
            value={formatCop(summary.total)}
            tone={summary.count > 0 ? "danger" : "default"}
            caption={summary.count === 1 ? "1 cliente debe" : `${summary.count} clientes deben`}
          />
        </div>
        <div className="mt-4">
          <HeroSearch value={query} onChange={setQuery} placeholder="Buscar cliente..." label="Buscar cliente" />
        </div>
        <div className="mt-3">
          <HeroSegmented<ClientesSegment>
            label="Filtrar clientes"
            value={segment}
            onChange={setSegment}
            options={[
              { id: "deben", label: "Deben", count: summary.count },
              { id: "todos", label: "Todos", count: customers.length },
            ]}
          />
        </div>
      </HeroBlock>

      <Sheet>
        {loading && customers.length === 0 ? (
          <SkeletonRows />
        ) : customers.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Sin clientes aún."
            action={
              <OfflineLink
                href="/clientes/nuevo"
                className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
              >
                Agregar cliente
              </OfflineLink>
            }
          />
        ) : filtered.length === 0 ? (
          <RowGroupNote>{searching ? "No encontramos ese cliente." : "Nadie debe. Todos al día."}</RowGroupNote>
        ) : (
          <RowGroup label="Clientes">
            {filtered.map((c) => (
              <Row
                key={c.id}
                href={`/clientes/${c.id}`}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {c.name}
                    {pendingIds.includes(c.id) ? <PendingBadge /> : null}
                  </span>
                }
                meta={c.code || undefined}
                trailing={
                  c.debt > 0 ? (
                    <span className="text-[15px] font-semibold tabular-nums text-danger">{formatCop(c.debt)}</span>
                  ) : (
                    <Badge tone="ok">Al día</Badge>
                  )
                }
              />
            ))}
          </RowGroup>
        )}
      </Sheet>
    </div>
  );
}
