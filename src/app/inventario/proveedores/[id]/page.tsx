"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { RemoteSupplier } from "@/data/http/mappers";
import { routeId } from "@/data/pwa/ids";
import {
  inventoryStore,
  type PwaSupplierSurtir,
} from "@/store/inventoryStore";

export default function ProveedorFichaPage() {
  const params = useParams();
  const id = routeId(params.id);
  const [supplier, setSupplier] = useState<RemoteSupplier | null>(null);
  const [historial, setHistorial] = useState<PwaSupplierSurtir[]>([]);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const s = await inventoryStore.getSupplier(id);
    setSupplier(s ?? null);
    if (s) {
      setHistorial(await inventoryStore.listSupplierSurtidas(id));
    }
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!supplier) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/inventario" className="text-sm text-ink/70">
          ← Inventario
        </Link>
        <p className="text-sm text-ink/60">No encontramos ese proveedor.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/inventario"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {supplier.name}
        </h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        {supplier.phone && (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
              Teléfono
            </p>
            <p className="mt-1 text-base">{supplier.phone}</p>
          </>
        )}
        {supplier.notes && (
          <>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink/50">
              Notas
            </p>
            <p className="mt-1 text-base">{supplier.notes}</p>
          </>
        )}
        <p className="mt-4 text-sm text-ink/60">
          Aquí solo ves surtidos. No manejamos cuentas por pagar.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink/60">
          Historial de surtidas
        </h2>
        {historial.length === 0 ? (
          <p className="text-sm text-ink/60">
            Aún no hay surtidas con este proveedor.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {historial.map((h) => (
              <li
                key={h.moveId}
                className="rounded-2xl border border-ink/[0.08] bg-surface px-4 py-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{h.productName}</span>
                  <span className="font-semibold">{formatCop(h.totalCost)}</span>
                </div>
                <p className="mt-1 text-ink/60">
                  ×{h.qty}
                  {h.method ? ` · ${h.method}` : ""} ·{" "}
                  {new Date(h.createdAt).toLocaleDateString("es-CO")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
