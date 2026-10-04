"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { RemoteSupplier } from "@/data/http/mappers";
import { EntityBackLink, useEntityId } from "@/components/shell/entity-route";
import {
  inventoryStore,
  type PwaSupplierSurtir,
} from "@/store/inventoryStore";
import { getPwaAuthSession } from "@/data/http/session";
import { useProductImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

export default function ProveedorFichaPage() {
  const id = useEntityId();
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
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="flex flex-col gap-4">
        <EntityBackLink href="/inventario" className="text-sm text-ink-muted">
          ← Inventario
        </EntityBackLink>
        <p className="text-sm text-ink-muted">No encontramos ese proveedor.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <EntityBackLink
          href="/inventario"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </EntityBackLink>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {supplier.name}
        </h1>
      </header>

      <Card>
        {supplier.phone && (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Teléfono
            </p>
            <p className="mt-1 text-base">{supplier.phone}</p>
          </>
        )}
        {supplier.notes && (
          <>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-muted">
              Notas
            </p>
            <p className="mt-1 text-base">{supplier.notes}</p>
          </>
        )}
        <p className="mt-4 text-sm text-ink-muted">
          Aquí solo ves surtidos. No manejamos cuentas por pagar.
        </p>
      </Card>

      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setEditing((v) => !v);
          setEditError(null);
        }}
        className="w-full"
      >
        {editing ? "Cerrar edición" : "Editar proveedor"}
      </Button>

      {editing && (
        <Card>
          <label className="text-sm font-medium" htmlFor="editar-nombre-prov">
            Nombre
          </label>
          <Input
            id="editar-nombre-prov"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="mt-2"
          />
          <label className="mt-3 block text-sm font-medium" htmlFor="editar-tel-prov">
            Teléfono (opcional)
          </label>
          <Input
            id="editar-tel-prov"
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
            className="mt-2"
          />
          <label className="mt-3 block text-sm font-medium" htmlFor="editar-notas-prov">
            Notas (opcional)
          </label>
          <Input
            id="editar-notas-prov"
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            className="mt-2"
          />
          {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}
          <Button
            type="button"
            variant="primary"
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
            className="mt-3 w-full"
          >
            Guardar cambios
          </Button>
        </Card>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-muted">
          Historial de surtidas
        </h2>
        {historial.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Aún no hay surtidas con este proveedor.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {historial.map((h) => (
              <li
                key={h.moveId}
                className="rounded-[var(--r-lg)] border border-border bg-surface px-4 py-3 text-sm shadow-[var(--shadow-sm)]"
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
                <p className="mt-1 text-ink-muted">
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
