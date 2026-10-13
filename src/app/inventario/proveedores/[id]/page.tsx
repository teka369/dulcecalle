"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { RemoteSupplier } from "@/data/http/mappers";
import { useEntityId } from "@/components/shell/entity-route";
import {
  inventoryStore,
  type PwaSupplierSurtir,
} from "@/store/inventoryStore";
import { getPwaAuthSession } from "@/data/http/session";
import { useProductImageMap } from "@/data/pwa/product-image-map";
import { ProductThumbnail } from "@/components/product/ProductThumbnail";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";

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
      <div className="flex flex-col gap-4">
        <SkeletonHero />
        <SkeletonRows />
      </div>
    );
  }

  if (!supplier) {
    return (
      <HeroBlock size="medium" back={{ href: "/inventario", label: "Volver a Inventario", entity: true }} title="Inventario">
        <StateBlock onHero kind="empty" title="No encontramos ese proveedor." />
      </HeroBlock>
    );
  }

  const saveEdit = () => {
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
            };

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="medium"
        back={{ href: "/inventario", label: "Volver a Inventario", entity: true }}
        title={supplier.name}
        subtitle={
          supplier.phone ? (
            <a href={`tel:${supplier.phone.replace(/\s+/g, "")}`} className="underline underline-offset-2">
              {supplier.phone}
            </a>
          ) : undefined
        }
        action={
          <HeroPill
            label={editing ? "Cerrar" : "Editar"}
            onClick={() => {
              setEditing((v) => !v);
              setEditError(null);
            }}
          />
        }
      />

      <Sheet>
        <RowGroup label="Proveedor">
          {supplier.notes ? <Row title="Notas" meta={supplier.notes} /> : null}
          <Row title="Aquí solo ves surtidos." meta="No manejamos cuentas por pagar." />
        </RowGroup>

        {editing ? (
          <section className="flex flex-col gap-2">
            <SectionHead title="Editar" />
            <div className="rounded-[var(--r-lg)] border border-border bg-surface p-3">
              <label className="text-sm font-medium" htmlFor="editar-nombre-prov">
                Nombre
              </label>
              <Input id="editar-nombre-prov" value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-2" />
              <label className="mt-3 block text-sm font-medium" htmlFor="editar-tel-prov">
                Teléfono (opcional)
              </label>
              <Input
                id="editar-tel-prov"
                inputMode="tel"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="mt-2"
              />
              <label className="mt-3 block text-sm font-medium" htmlFor="editar-notas-prov">
                Notas (opcional)
              </label>
              <Input id="editar-notas-prov" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="mt-2" />
              {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}
              <Button type="button" variant="primary" disabled={editBusy} onClick={saveEdit} className="mt-3 w-full">
                Guardar cambios
              </Button>
            </div>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <SectionHead title="Surtidas" />
          {historial.length === 0 ? (
            <RowGroupNote>Aún no hay surtidas con este proveedor.</RowGroupNote>
          ) : (
            <RowGroup label="Surtidas">
              {historial.map((h) => (
                <Row
                  key={h.moveId}
                  leading={<ProductThumbnail secureUrl={imageMap.get(h.productId) ?? null} alt={h.productName} size="sm" decorative />}
                  title={h.productName}
                  meta={[`×${h.qty}`, h.method, new Date(h.createdAt).toLocaleDateString("es-CO")].filter(Boolean).join(" · ")}
                  trailing={<span className="text-[15px] font-semibold tabular-nums">{formatCop(h.totalCost)}</span>}
                />
              ))}
            </RowGroup>
          )}
        </section>
      </Sheet>
    </div>
  );
}
