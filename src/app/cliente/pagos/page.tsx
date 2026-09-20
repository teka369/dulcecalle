"use client";

import { useEffect, useState } from "react";
import { CustomerChrome, CustomerCacheNotice } from "@/components/customer/CustomerChrome";
import type { CustomerLedger } from "@/data/http/customer-api";
import { loadCachedCustomerLedger } from "@/data/pwa/customer-ledger-cache";
import { formatCop } from "@/domain/money";

export default function CustomerPaymentsPage() {
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
      <CustomerChrome title="Pagos">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Pagos">
        <p className="text-sm text-ink/60">Cargando…</p>
      </CustomerChrome>
    );
  }

  const payments = [...ledger.payments].sort(
    (a, b) =>
      (typeof b.createdAt === "number" ? b.createdAt : Date.parse(String(b.createdAt))) -
      (typeof a.createdAt === "number" ? a.createdAt : Date.parse(String(a.createdAt))),
  );
  const initials = ledger.initials;

  return (
    <CustomerChrome title="Pagos">
      {fromCache && capturedAt != null && (
        <CustomerCacheNotice capturedAt={capturedAt} />
      )}
      {payments.length === 0 ? (
        <p className="text-sm text-ink/60">No hay pagos registrados.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface p-4"
            >
              <span className="min-w-0">
                <span className="block font-medium">{p.method}</span>
                <span className="block text-xs text-ink/55">{p.occurredOn}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatCop(p.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {initials.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Deuda anterior</h2>
          {initials.map((d) => (
            <article
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface p-4"
            >
              <span className="min-w-0">
                <span className="block font-medium">Deuda anterior</span>
                <span className="block text-xs text-ink/55">{d.occurredOn}</span>
                {d.note && (
                  <span className="mt-1 block text-xs text-ink/55">{d.note}</span>
                )}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatCop(d.amount)}
              </span>
            </article>
          ))}
        </section>
      )}
    </CustomerChrome>
  );
}
