"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DebtStatementView } from "@/components/customers/DebtStatementView";
import type { DebtStatement } from "@/domain/debt/statement";
import type { RemoteCustomer } from "@/data/http/mappers";
import { routeId } from "@/data/pwa/ids";
import { customerStore } from "@/store/customerStore";

export default function ClienteFichaPage() {
  const params = useParams();
  const id = routeId(params.id);
  const [customer, setCustomer] = useState<RemoteCustomer | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [statement, setStatement] = useState<DebtStatement | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!id) {
      setReady(true);
      return;
    }
    const c = await customerStore.getCustomer(id);
    setCustomer(c ?? null);
    if (c) {
      setEditName(c.name);
      setEditPhone(c.phone ?? "");
    }
    if (c) {
      const result = await customerStore.getStatement(c.id);
      setStatement(result?.statement ?? null);
      setFromCache(result?.source === "cache");
    }
    setReady(true);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  if (!customer) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/clientes" className="text-sm text-ink/70">
          ← Clientes
        </Link>
        <p className="text-sm text-ink/60">No encontramos ese cliente.</p>
      </div>
    );
  }

  const hasDebt = customer.debt > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/clientes"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="min-w-0 truncate text-[22px] font-semibold tracking-tight">
          {customer.name}
        </h1>
      </header>
      {customer.code && (
        <p className="text-sm text-ink/55">Código {customer.code}</p>
      )}

      {fromCache && (
        <p className="text-xs text-ink/60">
          Sin conexión · movimientos registrados en este dispositivo.
        </p>
      )}

      {statement ? (
        <DebtStatementView statement={statement} />
      ) : (
        <p className="text-sm text-ink/60">No se pudo armar el detalle.</p>
      )}

      <button
        type="button"
        onClick={() => {
          setEditing((v) => !v);
          setEditError(null);
        }}
        className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface px-4 text-sm font-semibold"
      >
        {editing ? "Cerrar edición" : "Editar cliente"}
      </button>

      {editing && (
        <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <label className="text-sm font-medium" htmlFor="editar-nombre">
            Nombre
          </label>
          <input
            id="editar-nombre"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="mt-2 min-h-11 w-full rounded-[14px] border border-ink/10 px-3 text-base outline-none focus:border-primary"
          />
          <label className="mt-3 block text-sm font-medium" htmlFor="editar-telefono">
            Teléfono (opcional)
          </label>
          <input
            id="editar-telefono"
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
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
              void customerStore
                .patchCustomer({
                  customerId: customer.id,
                  name: editName,
                  phone: editPhone.trim() ? editPhone.trim() : null,
                })
                .then(() => customerStore.getCustomer(customer.id))
                .then((updated) => {
                  if (updated) {
                    setCustomer(updated);
                    setEditName(updated.name);
                    setEditPhone(updated.phone ?? "");
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
            Solo se puede cambiar nombre y teléfono. La deuda no se edita a mano.
          </p>
        </section>
      )}

      {hasDebt && (
        <Link
          href={`/clientes/${customer.id}/abono`}
          className="flex min-h-11 items-center justify-center rounded-[14px] bg-cta px-4 text-sm font-semibold text-white"
        >
          Registrar abono
        </Link>
      )}

      <Link
        href={`/clientes/${customer.id}/deuda-inicial`}
        className="flex min-h-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface px-4 text-sm font-semibold"
      >
        Agregar deuda anterior
      </Link>
    </div>
  );
}
