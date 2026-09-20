"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerChrome } from "@/components/customer/CustomerChrome";
import { getCustomerApi, type CustomerLedger } from "@/data/http/customer-api";
import { customerStatementRows } from "@/data/pwa/customer-portal";
import { formatCop } from "@/domain/money";

export default function CustomerStatementPage() {
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getCustomerApi()
      .ledger()
      .then(setLedger)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "No se pudo cargar.");
      });
  }, []);

  if (error) {
    return (
      <CustomerChrome title="Estado de cuenta">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Estado de cuenta">
        <p className="text-sm text-ink/60">Cargando…</p>
      </CustomerChrome>
    );
  }

  const rows = customerStatementRows(ledger);

  return (
    <CustomerChrome title="Estado de cuenta">
      <article className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink/50">
          Saldo actual
        </p>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            ledger.customer.debt > 0 ? "text-accent" : "text-ok"
          }`}
        >
          {formatCop(ledger.customer.debt)}
        </p>
      </article>

      {rows.length === 0 ? (
        <p className="text-sm text-ink/60">Aún no hay movimientos.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const body = (
              <span className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface p-4">
                <span className="min-w-0">
                  <span className="block font-medium">{row.title}</span>
                  <span className="block text-xs text-ink/55">{row.occurredOn}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatCop(row.amount)}
                </span>
              </span>
            );
            return (
              <li key={row.id}>
                {row.href ? <Link href={row.href}>{body}</Link> : body}
              </li>
            );
          })}
        </ul>
      )}
    </CustomerChrome>
  );
}
