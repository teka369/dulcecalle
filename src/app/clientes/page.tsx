"use client";

import Link from "next/link";
import { OfflineLink } from "@/components/shell/OfflineLink";
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
        <Link
          href="/clientes/nuevo"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] bg-cta text-xl font-semibold text-white"
          aria-label="Agregar cliente"
        >
          +
        </Link>
      </header>

      <label className="sr-only" htmlFor="buscar-cliente">
        Buscar cliente
      </label>
      <input
        id="buscar-cliente"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar cliente..."
        className="min-h-11 w-full rounded-[14px] border border-ink/10 bg-surface px-3 text-base outline-none focus:border-primary"
      />

      {loading && customers.length === 0 ? (
        <p className="text-sm text-ink/60">Cargando…</p>
      ) : customers.length === 0 ? (
        <div className="rounded-2xl border border-ink/10 bg-surface p-6 text-center">
          <p className="text-base font-medium">Sin clientes aún.</p>
          <Link
            href="/clientes/nuevo"
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
          >
            Agregar cliente
          </Link>
        </div>
      ) : filtered.length === 0 && searching ? (
        <p className="text-sm text-ink/60">No encontramos ese cliente.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((c) => (
            <li key={c.id}>
              <OfflineLink
                href={`/clientes/${c.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface p-4"
              >
                <span className="min-w-0 truncate">
                  <span className="block font-medium">
                    {c.name}
                    {pendingIds.includes(c.id) && (
                      <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-semibold text-ink/70">
                        ⏳ Pendiente
                      </span>
                    )}
                  </span>
                  {c.code && (
                    <span className="block text-xs text-ink/50">{c.code}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      c.debt > 0 ? "text-accent" : "text-ink/50"
                    }`}
                  >
                    {formatCop(c.debt)}
                  </span>
                  <span
                    className={`text-[11px] font-medium ${
                      c.debt > 0 ? "text-accent/80" : "text-ok"
                    }`}
                  >
                    {c.debt > 0 ? "Pendiente" : "Al día"}
                  </span>
                </span>
              </OfflineLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
