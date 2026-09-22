"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerChrome, CustomerCacheNotice } from "@/components/customer/CustomerChrome";
import type { CustomerLedger } from "@/data/http/customer-api";
import { loadCachedCustomerLedger } from "@/data/pwa/customer-ledger-cache";
import {
  customerPortalSummary,
  customerPortalTotals,
} from "@/data/pwa/customer-portal";
import { formatCop } from "@/domain/money";

export default function CustomerHomePage() {
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
      <CustomerChrome title="Tu consulta">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }

  if (!ledger) {
    return (
      <CustomerChrome title="Tu consulta">
        <p className="text-sm text-ink/60">Cargando…</p>
      </CustomerChrome>
    );
  }

  const summary = customerPortalSummary(ledger);
  const { totalComprado, totalAbonado, movimientos } =
    customerPortalTotals(ledger);

  return (
    <CustomerChrome>
      {fromCache && capturedAt != null && (
        <CustomerCacheNotice capturedAt={capturedAt} />
      )}
      <h1 className="text-[22px] font-semibold tracking-tight">
        Hola, {summary.name}
      </h1>
      <p className="text-sm text-ink/55">{summary.code}</p>

      <article className="rounded-2xl border border-ink/[0.08] bg-surface p-5">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink/50">
          Por cobrar
        </p>
        <p
          className={`mt-1 text-[34px] font-semibold tabular-nums ${
            summary.debt > 0 ? "text-accent" : "text-ok"
          }`}
        >
          {formatCop(summary.debt)}
        </p>
        <p className="mt-1 text-sm text-ink/55">
          {summary.debt > 0
            ? "Esto es lo que debes en este momento."
            : "Estás al día. No debes nada."}
        </p>
      </article>

      <section className="grid grid-cols-2 gap-2">
        <SummaryChip label="Total comprado" value={formatCop(totalComprado)} />
        <SummaryChip label="Total abonado" value={formatCop(totalAbonado)} />
        <SummaryChip label="Movimientos" value={String(movimientos)} />
        <SummaryChip
          label="Última actualización"
          value={
            capturedAt
              ? new Date(capturedAt).toLocaleDateString("es-CO", {
                  day: "numeric",
                  month: "short",
                })
              : "—"
          }
        />
      </section>

      <nav className="flex flex-col gap-2">
        <PortalLink href="/cliente/cuenta" label="Estado de cuenta" />
        <PortalLink href="/cliente/compras" label="Compras" />
        <PortalLink href="/cliente/pagos" label="Pagos" />
      </nav>
    </CustomerChrome>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-ink/[0.08] bg-surface p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-ink/50">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
    </article>
  );
}

function PortalLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between rounded-2xl border border-ink/[0.08] bg-surface px-4 text-sm font-semibold"
    >
      {label}
      <span aria-hidden>→</span>
    </Link>
  );
}
