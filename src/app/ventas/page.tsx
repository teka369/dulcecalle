"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCop } from "@/domain/money";
import { listSalesWithOfflineFallback, type LocalSaleRow } from "@/data/pwa/offline-sales";

const kindLabel: Record<string, string> = {
  paid: "Pagada",
  partial: "Parcial",
  credit: "Fiada",
};

export default function VentasPage() {
  const [sales, setSales] = useState<LocalSaleRow[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listSalesWithOfflineFallback()
      .then((result) => {
        setSales(result.sales);
        setFromCache(result.source === "cache");
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "No se pudo cargar.");
      });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-[22px] font-semibold">Ventas</h1>
        <Link
          href="/ventas/nueva"
          className="min-h-11 rounded-[14px] bg-cta px-3 text-sm font-semibold leading-[44px] text-white"
        >
          + Nueva venta
        </Link>
      </header>

      {error && <p className="text-sm text-danger">{error}</p>}

      {fromCache && sales.length > 0 && (
        <p className="text-xs text-ink/60">
          Sin conexión · mostrando ventas guardadas en este dispositivo.
        </p>
      )}

      {sales.length === 0 && !error ? (
        <p className="text-sm text-ink/60">
          {fromCache
            ? "No hay ventas guardadas en este dispositivo."
            : "Aún no hay ventas hoy."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sales.map((s) => (
            <li key={s.id}>
              <Link
                href={`/ventas/${s.id}`}
                className="block rounded-2xl border border-ink/[0.08] bg-surface p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {kindLabel[s.paymentKind] ?? s.paymentKind}
                    {s.pending && (
                      <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-xs font-semibold text-ink/70">
                        ⏳ Pendiente
                      </span>
                    )}
                  </span>
                  <span className="text-sm font-semibold">
                    {formatCop(s.saleTotal)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink/50">
                  Recibido {formatCop(s.amountReceived)} · Fiado{" "}
                  {formatCop(s.credit)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
