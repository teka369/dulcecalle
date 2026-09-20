"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CustomerChrome } from "@/components/customer/CustomerChrome";
import { getCustomerApi, type CustomerLedger } from "@/data/http/customer-api";
import { formatCop } from "@/domain/money";

export default function CustomerPurchasesPage() {
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
      <CustomerChrome title="Compras">
        <p className="text-sm text-danger">{error}</p>
      </CustomerChrome>
    );
  }
  if (!ledger) {
    return (
      <CustomerChrome title="Compras">
        <p className="text-sm text-ink/60">Cargando…</p>
      </CustomerChrome>
    );
  }

  const sales = [...ledger.sales].sort(
    (a, b) =>
      (typeof b.createdAt === "number" ? b.createdAt : Date.parse(String(b.createdAt))) -
      (typeof a.createdAt === "number" ? a.createdAt : Date.parse(String(a.createdAt))),
  );

  return (
    <CustomerChrome title="Compras">
      {sales.length === 0 ? (
        <p className="text-sm text-ink/60">Todavía no hay compras a tu nombre.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sales.map((s) => (
            <li key={s.id}>
              <Link
                href={`/cliente/compras/${s.id}`}
                className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-ink/[0.08] bg-surface p-4"
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {s.credit > 0
                      ? s.paymentKind === "partial"
                        ? "Venta parcial"
                        : "Fiado"
                      : "Compra"}
                  </span>
                  <span className="block text-xs text-ink/55">{s.occurredOn}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatCop(s.saleTotal)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CustomerChrome>
  );
}
