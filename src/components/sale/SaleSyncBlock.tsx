"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLocalDb } from "@/data/local/db";
import { getPwaAuthSession } from "@/data/http/session";
import { localRef } from "@/data/pwa/local-ref";
import type { LocalSaleRow } from "@/data/pwa/offline-sales";

/**
 * C01.1 (UX-C01 §2/§4.3) — sync state of a sale in its detail:
 * «Pendiente de enviar · Ref. local L-…», or the «Rechazada» resolution block
 * (reason + Registrar de nuevo + Resolver). Also «Reemplaza a L-…» when this
 * sale was registered to replace a rejected one.
 */
export function SaleSyncBlock({ sale }: { sale: LocalSaleRow }) {
  const [replaces, setReplaces] = useState<string | null>(null);
  useEffect(() => {
    const businessId = getPwaAuthSession().businessId;
    if (!businessId) return;
    void getLocalDb()
      .discardedOps.where("businessId")
      .equals(businessId)
      .filter((r) => r.replacedBy === sale.id)
      .first()
      .then((r) => setReplaces(r ? localRef(r.operationId, r.localCreatedAt) : null))
      .catch(() => undefined);
  }, [sale.id]);

  return (
    <>
      {replaces ? (
        <p className="text-sm text-ink-muted" data-testid="sale-replaces">
          Reemplaza a {replaces} (venta rechazada)
        </p>
      ) : null}
      {sale.syncState === "rejected" ? (
        <section
          data-testid="sale-rejected-block"
          className="rounded-[var(--r-lg)] border border-danger bg-danger-soft p-3"
        >
          <p className="text-sm font-semibold text-danger">! Rechazada</p>
          <p className="mt-1 text-sm">El servidor no la aceptó. Sigue guardada aquí hasta que la resuelvas.</p>
          {sale.rejectionReason ? (
            <p className="mt-1 text-sm">
              <span className="font-semibold">Motivo: </span>
              {sale.rejectionReason}
            </p>
          ) : null}
          {sale.localRef ? <p className="mt-1 text-xs text-ink-muted">Ref. local {sale.localRef}</p> : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <Link
              href={`/ventas/nueva?rechazada=${encodeURIComponent(sale.id)}`}
              className="inline-flex min-h-11 items-center rounded-[var(--r-md)] border border-border bg-surface px-4 text-sm font-semibold"
            >
              Registrar de nuevo
            </Link>
            <Link href="/sincronizacion" className="inline-flex min-h-11 items-center text-sm font-semibold underline">
              Resolver
            </Link>
          </div>
        </section>
      ) : sale.pending ? (
        <p className="text-sm text-ink-muted" data-testid="sale-pending-line">
          Pendiente de enviar{sale.localRef ? ` · Ref. local ${sale.localRef}` : ""}
        </p>
      ) : null}
    </>
  );
}
