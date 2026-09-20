"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CustomerChrome } from "@/components/customer/CustomerChrome";
import { getCustomerApi, type CustomerLedger } from "@/data/http/customer-api";
import { findCustomerSale } from "@/data/pwa/customer-portal";
import { routeId } from "@/data/pwa/ids";
import { formatCop } from "@/domain/money";

export default function CustomerPurchaseDetailPage() {
  const params = useParams();
  const id = routeId(params.id);
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
      <CustomerChrome title="Compra">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Compra">
        <p className="text-sm text-ink/60">Cargando…</p>
      </CustomerChrome>
    );
  }

  const sale = id ? findCustomerSale(ledger, id) : undefined;
  if (!sale) {
    return (
      <CustomerChrome title="Compra">
        <p className="text-sm text-ink/60">No encontramos esa compra.</p>
        <Link href="/cliente/compras" className="text-sm font-semibold">
          ← Compras
        </Link>
      </CustomerChrome>
    );
  }

  return (
    <CustomerChrome title="Compra">
      <Link href="/cliente/compras" className="text-sm font-semibold text-ink/70">
        ← Compras
      </Link>
      <p className="text-sm text-ink/55">{sale.occurredOn}</p>

      <ul className="flex flex-col gap-2">
        {sale.lines.map((l) => (
          <li
            key={l.id}
            className="flex items-start justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface p-4"
          >
            <span className="min-w-0">
              <span className="block font-medium">{l.productName}</span>
              <span className="block text-xs text-ink/55">
                {l.qty} × {formatCop(l.unitPrice)}
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {formatCop(l.lineTotal)}
            </span>
          </li>
        ))}
      </ul>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4 text-sm">
        <Row label="Total" value={formatCop(sale.saleTotal)} />
        <Row label="Recibido" value={formatCop(sale.amountReceived)} />
        <Row label="A crédito" value={formatCop(sale.credit)} />
        {sale.method && <Row label="Medio" value={sale.method} />}
      </section>

      {sale.returns.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Devoluciones</h2>
          {sale.returns.map((r) => (
            <article
              key={r.id}
              className="rounded-2xl border border-ink/[0.08] bg-surface p-4 text-sm"
            >
              <p className="text-xs text-ink/55">{r.occurredOn}</p>
              {r.lines.map((l) => (
                <p key={l.id}>
                  {l.qty} × {formatCop(l.unitPrice)}
                </p>
              ))}
              {r.debtReduced > 0 && (
                <p>Bajó deuda {formatCop(r.debtReduced)}</p>
              )}
              {r.refundAmount > 0 && (
                <p>Reembolso {formatCop(r.refundAmount)}</p>
              )}
            </article>
          ))}
        </section>
      )}
    </CustomerChrome>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-3 py-1">
      <span className="text-ink/60">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </p>
  );
}
