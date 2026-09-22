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
import { getPwaAuthSession } from "@/data/http/session";
import { useProductImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";

export default function ProveedorFichaPage() {
  const params = useParams();
  const id = routeId(params.id);
  const [supplier, setSupplier] = useState<RemoteSupplier | null>(null);
  const [historial, setHistorial] = useState<PwaSupplierSurtir[]>([]);
  const [ready, setReady] = useState(false);
  const imageMap = useProductImageMap(getPwaAuthSession().businessId);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const s = await inventoryStore.getSupplier(id);
    setSupplier(s ?? null);
    if (s) {
      setEditName(s.name);
      setEditPhone(s.phone ?? "");
      setEditNotes(s.notes ?? "");
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

      <button
        type="button"
        onClick={() => {
          setEditing((v) => !v);
          setEditError(null);
        }}
        className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface px-4 text-sm font-semibold"
      >
        {editing ? "Cerrar edición" : "Editar proveedor"}
      </button>

      {editing && (
        <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <label className="text-sm font-medium" htmlFor="editar-nombre-prov">
            Nombre
          </label>
          <input
            id="editar-nombre-prov"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
          <label className="mt-3 block text-sm font-medium" htmlFor="editar-tel-prov">
            Teléfono (opcional)
          </label>
          <input
            id="editar-tel-prov"
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
          <label className="mt-3 block text-sm font-medium" htmlFor="editar-notas-prov">
            Notas (opcional)
          </label>
          <input
            id="editar-notas-prov"
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
          {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}
          <button
            type="button"
            disabled={editBusy}
            onClick={() => {
              if (editBusy) return;
              setEditBusy(true);
              setEditError(null);
              void inventoryStore
                .patchSupplier({
                  supplierId: supplier.id,
                  name: editName,
                  phone: editPhone.trim() ? editPhone.trim() : null,
                  notes: editNotes.trim() ? editNotes.trim() : null,
                })
                .then(() => inventoryStore.getSupplier(supplier.id))
                .then((updated) => {
                  if (updated) {
                    setSupplier(updated);
                    setEditName(updated.name);
                    setEditPhone(updated.phone ?? "");
                    setEditNotes(updated.notes ?? "");
                  }
                  setEditing(false);
                })
                .catch((e: unknown) => {
                  setEditError(e instanceof Error ? e.message : "No se pudo guardar.");
                })
                .finally(() => setEditBusy(false));
            }}
            className="mt-3 min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            Guardar cambios
          </button>
        </section>
      )}

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
                  <span className="flex min-w-0 items-center gap-2">
                    <ProductThumbnail
                      secureUrl={imageMap.get(h.productId) ?? null}
                      alt={h.productName}
                      size="xs"
                    />
                    <span className="min-w-0 font-medium">{h.productName}</span>
                  </span>
                  <span className="shrink-0 font-semibold">{formatCop(h.totalCost)}</span>
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
