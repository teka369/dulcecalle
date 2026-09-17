"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { Sale, SaleReturn } from "@/domain/types";
import { saleRepository } from "@/repositories";

const kindLabel: Record<Sale["paymentKind"], string> = {
  paid: "Pagada",
  partial: "Parcial",
  credit: "Fiada",
};

type Returnable = NonNullable<
  Awaited<ReturnType<typeof saleRepository.getReturnable>>
>;

export default function VentaDetallePage() {
  const params = useParams();
  const id = Number(params.id);
  const [data, setData] = useState<Returnable | null>(null);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setReady(true);
      return;
    }
    const row = await saleRepository.getReturnable(id);
    setData(row ?? null);
    if (row) setReturns(await saleRepository.listReturns(id));
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/ventas" className="text-sm text-ink/70">
          ← Ventas
        </Link>
        <p className="text-sm text-ink/60">No encontramos esa venta.</p>
      </div>
    );
  }

  const { sale, lines, remainingValue } = data;
  const canReturn = remainingValue > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/ventas"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-white text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <div>
          <h1 className="text-[22px] font-semibold">Venta</h1>
          <p className="text-sm text-ink/60">{kindLabel[sale.paymentKind]}</p>
        </div>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-white p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
          Total
        </p>
        <p className="mt-1 text-2xl font-semibold">{formatCop(sale.saleTotal)}</p>
        <p className="mt-2 text-sm text-ink/60">
          Recibido {formatCop(sale.amountReceived)} · Fiado {formatCop(sale.credit)}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink/60">Productos</h2>
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li
              key={l.id}
              className="rounded-2xl border border-ink/[0.08] bg-white px-4 py-3 text-sm"
            >
              <div className="flex justify-between gap-2">
                <span className="font-medium">{l.productName}</span>
                <span className="font-semibold">{formatCop(l.lineTotal)}</span>
              </div>
              <p className="mt-1 text-xs text-ink/50">
                {l.qty} × {formatCop(l.unitPrice)}
                {l.returnedQty > 0
                  ? ` · Devuelto ${l.returnedQty} · Quedan ${l.remaining}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {canReturn && (
        <Link
          href={`/ventas/${sale.id}/devolver`}
          className="flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
        >
          Devolver
        </Link>
      )}

      {!canReturn && (
        <p className="text-sm text-ink/60">Esta venta ya se devolvió.</p>
      )}

      {returns.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink/60">Devoluciones</h2>
          <ul className="flex flex-col gap-2">
            {returns.map((r) => (
              <li
                key={r.id}
                className="rounded-2xl border border-ink/[0.08] bg-white px-4 py-3 text-sm"
              >
                <div className="flex justify-between gap-2">
                  <span>Devolución</span>
                  <span className="font-semibold text-danger">
                    −{formatCop(r.refundAmount + r.debtReduced)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink/50">
                  {r.refundAmount > 0
                    ? `Salieron ${formatCop(r.refundAmount)} de ${r.method}`
                    : "Sin salida de caja"}
                  {r.debtReduced > 0
                    ? ` · Deuda −${formatCop(r.debtReduced)}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
