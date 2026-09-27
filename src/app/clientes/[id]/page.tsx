"use client";

import Link from "next/link";
import { OfflineLink } from "@/components/shell/OfflineLink";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DebtStatementView } from "@/components/customers/DebtStatementView";
import type { DebtStatement } from "@/domain/debt/statement";
import type { RemoteCustomer } from "@/data/http/mappers";
import { routeId } from "@/data/pwa/ids";
import { customerStore } from "@/store/customerStore";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Spinner } from "@/components/ui/Spinner";

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
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/clientes" className="text-sm text-ink-muted">
          ← Clientes
        </Link>
        <p className="text-sm text-ink-muted">No encontramos ese cliente.</p>
      </div>
    );
  }

  const hasDebt = customer.debt > 0;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <Link
          href="/clientes"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="min-w-0 truncate text-[22px] font-semibold tracking-tight">
          {customer.name}
        </h1>
      </header>
      {customer.code && (
        <p className="text-sm text-ink-muted">Código {customer.code}</p>
      )}

      {fromCache && (
        <p className="text-xs text-ink-muted">
          Sin conexión · movimientos registrados en este dispositivo.
        </p>
      )}

      {statement ? (
        <DebtStatementView statement={statement} />
      ) : (
        <p className="text-sm text-ink-muted">No se pudo armar el detalle.</p>
      )}

      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setEditing((v) => !v);
          setEditError(null);
        }}
        className="w-full"
      >
        {editing ? "Cerrar edición" : "Editar cliente"}
      </Button>

      {editing && (
        <Card>
          <label className="text-sm font-medium" htmlFor="editar-nombre">
            Nombre
          </label>
          <Input
            id="editar-nombre"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="mt-2"
          />
          <label className="mt-3 block text-sm font-medium" htmlFor="editar-telefono">
            Teléfono (opcional)
          </label>
          <Input
            id="editar-telefono"
            value={editPhone}
            onChange={(e) => setEditPhone(e.target.value)}
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
            className="mt-3 w-full"
          >
            Guardar cambios
          </Button>
          <p className="mt-2 text-xs text-ink-muted">
            Solo se puede cambiar nombre y teléfono. La deuda no se edita a mano.
          </p>
        </Card>
      )}

      {hasDebt && (
        <OfflineLink
          href={`/clientes/${customer.id}/abono`}
          className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
        >
          Registrar abono
        </OfflineLink>
      )}

      <Link
        href={`/clientes/${customer.id}/deuda-inicial`}
        className="flex min-h-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface px-4 text-sm font-semibold"
      >
        Agregar deuda anterior
      </Link>
    </div>
  );
}
