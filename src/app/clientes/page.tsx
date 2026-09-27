"use client";

import { OfflineLink } from "@/components/shell/OfflineLink";
import { Badge } from "@/components/ui/Badge";
import { Empty } from "@/components/ui/Empty";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";
import { useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import { getPendingCustomerIds } from "@/data/pwa/offline-catalog";
import { useCustomers } from "@/store/customerStore";

export default function ClientesPage() {
  const { customers, refresh, loading } = useCustomers();
  const [query, setQuery] = useState("");
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  useEffect(() => {
    void refresh();
    void getPendingCustomerIds().then(setPendingIds);
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(q));
  }, [customers, query]);

  const searching = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <h1 className="text-[22px] font-semibold tracking-tight">Clientes</h1>
        <OfflineLink
          href="/clientes/nuevo"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] bg-cta text-xl font-semibold text-cta-fg"
          ariaLabel="Agregar cliente"
        >
          +
        </OfflineLink>
      </header>

      <label className="sr-only" htmlFor="buscar-cliente">
        Buscar cliente
      </label>
      <Input
        id="buscar-cliente"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar cliente..."
      />

      {loading && customers.length === 0 ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : customers.length === 0 ? (
        <Empty
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
      ) : filtered.length === 0 && searching ? (
        <p className="text-sm text-ink-muted">No encontramos ese cliente.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((c) => (
            <li key={c.id}>
              <OfflineLink
                href={`/clientes/${c.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]"
              >
                <span className="min-w-0 truncate">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {c.name}
                    {pendingIds.includes(c.id) && (
                      <Badge tone="warning">⏳ Pendiente</Badge>
                    )}
                  </span>
                  {c.code && (
                    <span className="block text-xs text-ink-muted">{c.code}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      c.debt > 0 ? "text-accent" : "text-ink-muted"
                    }`}
                  >
                    {formatCop(c.debt)}
                  </span>
                  <Badge tone={c.debt > 0 ? "info" : "ok"}>
                    {c.debt > 0 ? "Pendiente" : "Al día"}
                  </Badge>
                </span>
              </OfflineLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
