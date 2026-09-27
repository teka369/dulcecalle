"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerChrome, CustomerCacheNotice } from "@/components/customer/CustomerChrome";
import type { CustomerLedger } from "@/data/http/customer-api";
import { loadCachedCustomerLedger } from "@/data/pwa/customer-ledger-cache";
import { customerStatementRows } from "@/data/pwa/customer-portal";
import { formatCop } from "@/domain/money";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Spinner } from "@/components/ui/Spinner";

export default function CustomerStatementPage() {
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <CustomerChrome title="Estado de cuenta">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Estado de cuenta">
        <div className="flex flex-col items-center gap-2 py-10">
          <Spinner />
          <p className="text-sm text-ink-muted">Cargando…</p>
        </div>
      </CustomerChrome>
    );
  }

  const rows = customerStatementRows(ledger);

  return (
    <CustomerChrome title="Estado de cuenta">
      {fromCache && capturedAt != null && (
        <CustomerCacheNotice capturedAt={capturedAt} />
      )}
      <Card as="article">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Saldo actual
        </p>
        <p
          className={`mt-1 text-2xl font-semibold tabular-nums ${
            ledger.customer.debt > 0 ? "text-accent" : "text-ok"
          }`}
        >
          {formatCop(ledger.customer.debt)}
        </p>
      </Card>

      {rows.length === 0 ? (
        <Empty
          title="Todavía no tienes movimientos registrados."
          description="Cuando compres o abones, aparecerán aquí."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const lowers = row.kind === "pago" || row.kind === "devolucion";
            const body = (
              <span className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
                <span className="min-w-0">
                  <span className="block font-medium">{row.title}</span>
                  <span className="block text-xs text-ink-muted">
                    {row.occurredOn} ·{" "}
                    {lowers ? "baja tu deuda" : "sube tu deuda"}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-sm font-semibold tabular-nums ${
                    lowers ? "text-ok" : "text-accent"
                  }`}
                >
                  {lowers ? "−" : "+"}
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
