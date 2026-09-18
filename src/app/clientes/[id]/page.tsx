"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { DebtStatementView } from "@/components/customers/DebtStatementView";
import type { DebtStatement } from "@/domain/debt/statement";
import type { Customer } from "@/domain/types";
import { customerStore } from "@/store/customerStore";

export default function ClienteFichaPage() {
  const params = useParams();
  const id = Number(params.id);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [statement, setStatement] = useState<DebtStatement | null>(null);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) {
      setReady(true);
      return;
    }
    const c = await customerStore.getCustomer(id);
    setCustomer(c ?? null);
    if (c?.id != null) {
      setStatement(await customerStore.getStatement(c.id));
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

      {statement ? (
        <DebtStatementView statement={statement} />
      ) : (
        <p className="text-sm text-ink/60">No se pudo armar el detalle.</p>
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
