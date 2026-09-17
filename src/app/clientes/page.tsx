"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatCop } from "@/domain/money";
import { useCustomers } from "@/store/customerStore";

export default function ClientesPage() {
  const { customers, refresh, loading } = useCustomers();
  const [query, setQuery] = useState("");

  useEffect(() => {
    void refresh();
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
        className="min-h-11 w-full rounded-[14px] border border-ink/10 bg-white px-3 text-base outline-none focus:border-primary"
      />

      {loading && customers.length === 0 ? (
        <p className="text-sm text-ink/60">Cargando…</p>
      ) : customers.length === 0 ? (
        <div className="rounded-2xl border border-ink/10 bg-white p-6 text-center">
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
              <Link
                href={`/clientes/${c.id}`}
                className="flex min-h-11 items-center justify-between gap-2 rounded-2xl border border-ink/[0.08] bg-white p-4"
              >
                <span className="font-medium">{c.name}</span>
                <span
                  className={`text-sm font-semibold ${
                    c.debt > 0 ? "text-accent" : "text-ink/50"
                  }`}
                >
                  {formatCop(c.debt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
