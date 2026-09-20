"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCop } from "@/domain/money";
import type { RemoteSale } from "@/data/http/mappers";
import { getPwaApi } from "@/data/pwa/api";

const kindLabel: Record<string, string> = {
  paid: "Pagada",
  partial: "Parcial",
  credit: "Fiada",
};

export default function VentasPage() {
  const [sales, setSales] = useState<RemoteSale[]>([]);

  useEffect(() => {
    void getPwaApi()
      .sales.list()
      .then(setSales)
      .catch(() => setSales([]));
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

      {sales.length === 0 ? (
        <p className="text-sm text-ink/60">Aún no hay ventas hoy.</p>
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
