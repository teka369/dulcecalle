"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { RemoteProduct, RemoteStockMove } from "@/data/http/mappers";
import { routeId } from "@/data/pwa/ids";
import { inventoryStore } from "@/store/inventoryStore";

const REASON_LABEL: Record<string, string> = {
  surtir: "Surtir",
  me_lo_comi: "Me lo comí",
  regalar: "Regalo",
  perdido: "Perdido / dañado",
  sale: "Venta",
  adjust: "Ajuste",
  inicial: "Stock inicial",
  devolucion: "Devolución",
};

export default function ProductoFichaPage() {
  const params = useParams();
  const id = routeId(params.id);
  const [product, setProduct] = useState<RemoteProduct | null>(null);
  const [moves, setMoves] = useState<RemoteStockMove[]>([]);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editLow, setEditLow] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const p = await inventoryStore.getProduct(id);
    setProduct(p ?? null);
    if (p) {
      setEditName(p.name);
      setEditPrice(String(p.price));
      setEditLow(String(p.lowStockAt));
    }
    if (p) {
      setMoves(await inventoryStore.listProductMoves(id));
    }
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!product) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/inventario" className="text-sm text-ink/70">
          ← Inventario
        </Link>
        <p className="text-sm text-ink/60">No encontramos ese producto.</p>
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
          {product.name}
        </h1>
      </header>

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink/50">
          Stock
        </p>
        <p className="mt-1 text-2xl font-semibold">{product.stock}</p>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink/50">
          Precio venta
        </p>
        <p className="mt-1 text-lg font-semibold">{formatCop(product.price)}</p>
        {product.avgCost > 0 ? (
          <p className="mt-2 text-sm text-ink/50">
            Costo prom. {formatCop(product.avgCost)}
          </p>
        ) : product.stock > 0 ? (
          <p className="mt-2 text-sm text-ink/50">
            Costo $0 (regalo o no se sabe). Se actualiza al surtir.
          </p>
        ) : null}
      </section>

      <Link
        href={`/inventario/${product.id}/surtir`}
        className="flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
      >
        Surtir
      </Link>

      <button
        type="button"
        onClick={() => {
          setEditing((v) => !v);
          setEditError(null);
        }}
        className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface px-4 text-sm font-semibold"
      >
        {editing ? "Cerrar edición" : "Editar producto"}
      </button>

      {editing && (
        <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <label className="text-sm font-medium" htmlFor="editar-nombre-prod">
            Nombre
          </label>
          <input
            id="editar-nombre-prod"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
          <label className="mt-3 block text-sm font-medium" htmlFor="editar-precio-prod">
            Precio de venta
          </label>
          <input
            id="editar-precio-prod"
            inputMode="numeric"
            value={editPrice}
            onChange={(e) => setEditPrice(e.target.value.replace(/\D/g, ""))}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
          <label className="mt-3 block text-sm font-medium" htmlFor="editar-low-prod">
            Avisar cuando el stock sea menor o igual a
          </label>
          <input
            id="editar-low-prod"
            inputMode="numeric"
            value={editLow}
            onChange={(e) => setEditLow(e.target.value.replace(/\D/g, ""))}
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
                .patchProduct({
                  productId: product.id,
                  name: editName,
                  priceRaw: editPrice,
                  lowStockAtRaw: editLow,
                })
                .then(() => inventoryStore.getProduct(product.id))
                .then((updated) => {
                  if (updated) {
                    setProduct(updated);
                    setEditName(updated.name);
                    setEditPrice(String(updated.price));
                    setEditLow(String(updated.lowStockAt));
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
          <p className="mt-2 text-xs text-ink/60">
            El stock y el costo solo cambian con movimientos. Las ventas
            anteriores conservan el precio con el que se cobraron.
          </p>
        </section>
      )}

      {!product.archivedAt && !confirmArchive && (
        <button
          type="button"
          onClick={() => setConfirmArchive(true)}
          className="flex min-h-11 items-center justify-center rounded-[14px] border border-danger/30 bg-surface px-4 text-sm font-semibold text-danger"
        >
          Archivar producto
        </button>
      )}

      {!product.archivedAt && confirmArchive && (
        <section className="rounded-2xl border border-danger/20 bg-danger/5 p-4">
          <p className="text-sm font-semibold">¿Archivar este producto?</p>
          <p className="mt-1 text-xs leading-relaxed text-ink/70">
            Dejará de aparecer para vender o surtir, pero su historial se
            conserva. Esta acción no se puede deshacer desde aquí.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={editBusy}
              onClick={() => setConfirmArchive(false)}
              className="min-h-11 rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={editBusy}
              onClick={() => {
                if (editBusy) return;
                setEditBusy(true);
                setEditError(null);
                void inventoryStore
                  .archiveProduct(product.id)
                  .then(() => inventoryStore.getProduct(product.id))
                  .then((updated) => {
                    if (updated) setProduct(updated);
                    setConfirmArchive(false);
                  })
                  .catch((e: unknown) => {
                    setEditError(e instanceof Error ? e.message : "No se pudo archivar.");
                  })
                  .finally(() => setEditBusy(false));
              }}
              className="min-h-11 rounded-[14px] bg-danger text-sm font-semibold text-white disabled:opacity-40"
            >
              Archivar
            </button>
          </div>
          {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink/60">
          Ajustes de stock
        </h2>
        <div className="flex flex-col gap-2">
          <ActionLink
            href={`/inventario/${product.id}/me-lo-comi`}
            label="Me lo comí"
          />
          <ActionLink
            href={`/inventario/${product.id}/regalo`}
            label="Regalo"
          />
          <ActionLink
            href={`/inventario/${product.id}/perdido`}
            label="Perdido / dañado"
          />
        </div>
      </section>

      {moves.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink/60">Historial</h2>
          <ul className="flex flex-col gap-2">
            {moves.slice(0, 20).map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-2xl border border-ink/[0.08] bg-surface px-4 py-3 text-sm"
              >
                <span>
                  {REASON_LABEL[m.reason] ?? m.reason}
                  {m.note ? (
                    <span className="mt-0.5 block text-xs text-ink/50">
                      {m.note}
                    </span>
                  ) : null}
                </span>
                <span className="font-semibold">
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface px-4 text-sm font-semibold"
    >
      {label}
    </Link>
  );
}
