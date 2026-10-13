"use client";

import { useCallback, useEffect, useState } from "react";
import { DebtStatementView } from "@/components/customers/DebtStatementView";
import type { DebtStatement } from "@/domain/debt/statement";
import type { RemoteCustomer } from "@/data/http/mappers";
import { useEntityId } from "@/components/shell/entity-route";
import { customerStore } from "@/store/customerStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroAmount } from "@/components/ui/HeroAmount";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { QuickTiles } from "@/components/ui/QuickTiles";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonHero, SkeletonRows } from "@/components/ui/Skeleton";
import { formatCop } from "@/domain/money";

export default function ClienteFichaPage() {
  const id = useEntityId();
  const [customer, setCustomer] = useState<RemoteCustomer | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [statement, setStatement] = useState<DebtStatement | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [ready, setReady] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);

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
      <div className="flex flex-col gap-4">
        <SkeletonHero />
        <SkeletonRows />
      </div>
    );
  }

  if (!customer) {
    return (
      <HeroBlock size="medium" back={{ href: "/clientes", label: "Volver a Clientes", entity: true }} title="Clientes">
        <StateBlock onHero kind="empty" title="No encontramos ese cliente." />
      </HeroBlock>
    );
  }

  const hasDebt = customer.debt > 0;
  const savePin = () => {
    if (pinBusy) return;
    setPinBusy(true);
    setPinMessage(null);
    void customerStore
      .setCustomerPin(customer.id, pin)
      .then(() => {
        setPin("");
        setPinMessage("PIN guardado. No vuelve a mostrarse.");
      })
      .catch((e: unknown) => {
        setPinMessage(e instanceof Error ? e.message : "No se pudo guardar el PIN.");
      })
      .finally(() => setPinBusy(false));
  };
  const saveEdit = () => {
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
  };
  const identity = [customer.code, customer.phone].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="medium"
        back={{ href: "/clientes", label: "Volver a Clientes", entity: true }}
        title={customer.name}
        subtitle={identity || undefined}
        offline={fromCache ? { text: "Sin conexión · movimientos registrados en este dispositivo." } : undefined}
        action={
          <HeroPill
            label={editing ? "Cerrar" : "Editar"}
            onClick={() => {
              setEditing((v) => !v);
              setEditError(null);
            }}
          />
        }
      >
        <div className="mt-5">
          <HeroAmount
            label={hasDebt ? "Debe" : "Al día"}
            value={formatCop(customer.debt)}
            tone={hasDebt ? "danger" : "ok"}
          />
        </div>
        {hasDebt ? (
          <div className="mt-4">
            <HeroPill primary label="Registrar abono" href={`/clientes/${customer.id}/abono`} />
          </div>
        ) : null}
      </HeroBlock>

      <Sheet>
        <QuickTiles
          tiles={[
            { href: `/clientes/${customer.id}/deuda-inicial`, label: "Agregar deuda anterior", icon: "plus" },
            { href: `#pin-del-portal`, label: "PIN del portal", icon: "users" },
          ]}
        />

        {statement ? (
          <DebtStatementView statement={statement} />
        ) : (
          <StateBlock kind="error" title="No se pudo armar el detalle." />
        )}

        {editing ? (
          <section className="flex flex-col gap-2" aria-labelledby="editar-head">
            <div id="editar-head">
              <SectionHead title="Editar" />
            </div>
            <div className="rounded-[var(--r-lg)] border border-border bg-surface p-3">
              <label className="text-sm font-medium" htmlFor="editar-nombre">
                Nombre
              </label>
              <Input id="editar-nombre" value={editName} onChange={(e) => setEditName(e.target.value)} className="mt-2" />
              <label className="mt-3 block text-sm font-medium" htmlFor="editar-telefono">
                Teléfono (opcional)
              </label>
              <Input id="editar-telefono" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="mt-2" />
              {editError && <p className="mt-2 text-sm text-danger">{editError}</p>}
              <Button type="button" variant="primary" disabled={editBusy} onClick={saveEdit} className="mt-3 w-full">
                Guardar cambios
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setEditError(null);
                }}
                className="mt-2 w-full"
              >
                Cerrar edición
              </Button>
              <p className="mt-2 text-xs text-ink-muted">
                Solo se puede cambiar nombre y teléfono. La deuda no se edita a mano.
              </p>
            </div>
          </section>
        ) : null}

        <section id="pin-del-portal" className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setPinOpen((v) => !v)}
            aria-expanded={pinOpen}
            aria-controls="pin-panel"
            className="flex min-h-11 items-center justify-between text-left"
          >
            <SectionHead title="PIN del portal" />
            <span className="text-xs font-semibold text-ink underline underline-offset-2">{pinOpen ? "Cerrar" : "Abrir"}</span>
          </button>
          {pinOpen || pinMessage ? (
            <div id="pin-panel" className="rounded-[var(--r-lg)] border border-border bg-surface p-3">
              <label className="text-sm font-medium" htmlFor="pin-cliente">
                PIN
              </label>
              <p className="mt-1 text-xs text-ink-muted">6 dígitos. No se puede ver después. Sin PIN el cliente no entra.</p>
              <Input
                id="pin-cliente"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="mt-2"
                inputMode="numeric"
                autoComplete="off"
                type="password"
                maxLength={6}
              />
              {pinMessage && <p className="mt-2 text-sm text-ink-muted" role="status">{pinMessage}</p>}
              <Button type="button" variant="secondary" disabled={pinBusy} onClick={savePin} className="mt-3 w-full">
                {pinBusy ? "Guardando…" : "Guardar PIN"}
              </Button>
            </div>
          ) : null}
        </section>
      </Sheet>
    </div>
  );
}
