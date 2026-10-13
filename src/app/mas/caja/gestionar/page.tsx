"use client";

import { useEffect, useState } from "react";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row as UiRow } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { kindLabel } from "@/components/cash/cash";
import { formatCop } from "@/domain/money";
import { getPwaApi } from "@/data/pwa/api";
import { assignMoveWithOfflineFallback } from "@/data/pwa/offline-operations";

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
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  useEffect(() => {
    const api = getPwaApi();
    void api.cash.listSessions().then((data) => setRows(data as Row[])).catch((e: unknown) => setError(e instanceof Error ? e.message : "No se pudieron cargar las cajas."));
    void api.cash.unassigned().then((data) => setOrphans(data as typeof orphans)).catch(() => setOrphans([]));
  }, []);

  const pending = rows?.filter((row) => !row.regularized) ?? [];
  const closed = rows?.filter((row) => row.regularized) ?? [];

  const ago = (n: number) => (n <= 0 ? "hoy" : n === 1 ? "hace 1 día" : `hace ${n} días`);

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="medium"
        back={{ href: "/mas/caja", label: "Volver a Caja" }}
        title="Gestionar cajas"
        subtitle={rows ? (pending.length === 1 ? "1 pendiente" : `${pending.length} pendientes`) : undefined}
      />
      <Sheet>
        {error ? <StateBlock kind="error" title="No se pudieron cargar las cajas." body={error} /> : null}
        {!rows && !error ? <SkeletonRows /> : null}
        {rows ? (
          <>
            {orphans.length > 0 ? (
              <section className="flex flex-col gap-2">
                <SectionHead title="Movimientos sin caja" />
                <StateBlock
                  kind="offline-miss"
                  title="Estos movimientos no se asignaron solos."
                  body="Revísalos antes de pasar un saldo."
                />
                {pending[0] ? (
                  <label className="text-sm text-ink">
                    Asignar a
                    <select
                      className="mt-1 h-14 w-full rounded-[var(--r-md)] border border-border bg-surface px-3 text-base"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Elige la caja</option>
                      {pending.map((row) => (
                        <option key={row.id} value={row.id}>
                          Caja del {row.localDate}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <RowGroup label="Movimientos sin caja">
                  {orphans.map((move) => (
                    <UiRow
                      key={move.id}
                      title={`${kindLabel(move.kind)} · ${move.method}`}
                      meta={move.occurredOn}
                      trailing={
                        <>
                          <span className="text-[15px] font-semibold tabular-nums">{formatCop(move.amount)}</span>
                          <button
                            type="button"
                            className="min-h-11 text-xs font-semibold text-ink underline underline-offset-2 disabled:opacity-40"
                            disabled={!target}
                            onClick={() =>
                              void assignMoveWithOfflineFallback(move.id, target).then(() =>
                                setOrphans((rows) => rows.filter((row) => row.id !== move.id)),
                              )
                            }
                          >
                            Asignar a esa caja
                          </button>
                        </>
                      }
                    />
                  ))}
                </RowGroup>
              </section>
            ) : null}

            <section className="flex flex-col gap-2">
              <SectionHead title={`Pendientes (${pending.length})`} />
              {pending.length === 0 ? (
                <RowGroupNote>No hay cajas pendientes.</RowGroupNote>
              ) : (
                <RowGroup label="Pendientes">
                  {pending.map((row) => (
                    <UiRow
                      key={row.id}
                      href={`/mas/caja/gestionar/${row.id}`}
                      title={`Caja del ${row.localDate} · ${ago(row.ageDays)}`}
                      meta={
                        <>
                          Esperado {formatCop(row.expectedEfectivo)} · Nequi {formatCop(row.expectedNequi)} · {row.moveCount} mov.
                          {row.requiresCarry ? (
                            <span className="block text-ink">⚠ Hay que pasar el saldo. No se puede cerrar solo contando.</span>
                          ) : null}
                          {row.laterActivity ? <span className="block text-ink">⚠ Tiene movimientos posteriores.</span> : null}
                        </>
                      }
                      trailing={<span className="text-xs font-semibold text-ink">Gestionar</span>}
                    />
                  ))}
                </RowGroup>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowClosed((v) => !v)}
                aria-expanded={showClosed}
                className="flex min-h-11 items-center justify-between"
              >
                <SectionHead title={`Cerradas (${closed.length})`} />
                <span className="text-xs font-semibold text-ink underline underline-offset-2">{showClosed ? "Ocultar" : "Ver"}</span>
              </button>
              {showClosed ? (
                closed.length === 0 ? (
                  <RowGroupNote>Aún no hay cajas cerradas.</RowGroupNote>
                ) : (
                  <RowGroup label="Cerradas">
                    {closed.map((row) => (
                      <UiRow key={row.id} title={`Caja del ${row.localDate}`} meta="Cerrada" />
                    ))}
                  </RowGroup>
                )
              ) : null}
            </section>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
