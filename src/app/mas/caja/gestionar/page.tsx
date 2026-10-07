"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Spinner } from "@/components/ui/Spinner";
import { formatCop } from "@/domain/money";
import { getPwaApi } from "@/data/pwa/api";

type Row = {
  id: string;
  localDate: string;
  openedAt: string;
  openingFloat: number;
  expectedEfectivo: number;
  expectedNequi: number;
  moveCount: number;
  laterActivity: boolean;
  ageDays: number;
  canCountClose: boolean;
  requiresCarry: boolean;
  regularized: boolean;
  closedAt: string | null;
};

export default function GestionarCajasPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [orphans, setOrphans] = useState<Array<{ id: string; occurredOn: string; kind: string; method: string; amount: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = getPwaApi();
    void api.cash.listSessions().then((data) => setRows(data as Row[])).catch((e: unknown) => setError(e instanceof Error ? e.message : "No se pudieron cargar las cajas."));
    void api.cash.unassigned().then((data) => setOrphans(data as typeof orphans)).catch(() => setOrphans([]));
  }, []);

  const pending = rows?.filter((row) => !row.regularized) ?? [];
  const closed = rows?.filter((row) => row.regularized) ?? [];

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link href="/mas/caja" className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg" aria-label="Volver">←</Link>
        <h1 className="text-[22px] font-semibold">Gestionar cajas</h1>
      </header>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!rows && !error && <div className="flex justify-center py-10"><Spinner /></div>}
      {rows && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Pendientes ({pending.length})</h2>
            {pending.length === 0 && <p className="text-sm text-ink-muted">No hay cajas pendientes.</p>}
            {pending.map((row) => (
              <Card key={row.id} className="flex flex-col gap-1">
                <p className="font-semibold">Caja del {row.localDate}</p>
                <p className="text-sm text-ink-muted">Efectivo esperado: {formatCop(row.expectedEfectivo)}</p>
                <p className="text-sm text-ink-muted">Nequi esperado: {formatCop(row.expectedNequi)}</p>
                <p className="text-sm text-ink-muted">{row.moveCount} movimientos · {row.ageDays} días</p>
                {row.laterActivity && <p className="text-sm">Tiene movimientos posteriores.</p>}
                {row.requiresCarry && <p className="text-sm">Hay que pasar el saldo. No se puede cerrar solo contando.</p>}
                <Link href={`/mas/caja/gestionar/${row.id}`} className="mt-2 text-sm font-semibold">Gestionar</Link>
              </Card>
            ))}
          </section>
          {orphans.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold">Movimientos sin caja</h2>
              <p className="text-sm text-ink-muted">Estos movimientos no se asignaron solos. Revísalos antes de pasar un saldo.</p>
              {orphans.map((move) => (
                <p key={move.id} className="text-sm">{move.occurredOn} · {move.kind} · {move.method} · {formatCop(move.amount)}</p>
              ))}
            </section>
          )}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Cerradas</h2>
            {closed.map((row) => (
              <Card key={row.id}>
                <p className="font-medium">Caja del {row.localDate}</p>
                <p className="text-sm text-ink-muted">Cerrada</p>
              </Card>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
