"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { Customer } from "@/domain/types";
import {
  customerStore,
} from "@/store/customerStore";
import type { CustomerHistoryItem } from "@/repositories/customerRepository";

export default function ClienteFichaPage() {
  const params = useParams();
  const id = Number(params.id);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [history, setHistory] = useState<CustomerHistoryItem[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setReady(true);
      return;
    }
    const c = await customerStore.getCustomer(id);
    setCustomer(c ?? null);
    if (c) {
      setHistory(await customerStore.getHistory(id));
    }
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!customer) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/clientes" className="text-sm text-ink/70">
          ← Clientes
        </Link>
        <p className="text-sm text-ink/60">No encontramos ese cliente.</p>
      </div>
    );
  }

  const hasDebt = customer.debt > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/clientes"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {customer.name}
        </h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
          Saldo
        </p>
        <p
          className={`mt-1 text-2xl font-semibold ${
            hasDebt ? "text-accent" : "text-ink"
          }`}
        >
          {formatCop(customer.debt)}
        </p>
        {!hasDebt && (
          <p className="mt-1 text-sm text-ink/60">No debe nada</p>
        )}
      </section>

      {hasDebt && (
        <Link
          href={`/clientes/${customer.id}/abono`}
          className="flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
        >
          Registrar abono
        </Link>
      )}

      {history.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink/60">Historial</h2>
          <ul className="flex flex-col gap-2">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between rounded-2xl border border-ink/[0.08] bg-white px-4 py-3 text-sm"
              >
                <span>{h.label}</span>
                <span className="font-semibold">{formatCop(h.amount)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
