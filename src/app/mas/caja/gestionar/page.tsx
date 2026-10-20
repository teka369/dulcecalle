"use client";

import { errorText } from "@/domain/ux/user-message";
import { Button } from "@/components/ui/Button";
import { useEffect, useRef, useState } from "react";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { RowGroup, RowGroupNote } from "@/components/ui/RowGroup";
import { Row as UiRow } from "@/components/ui/Row";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { kindLabel, shortDay } from "@/components/cash/cash";
import { formatCop } from "@/domain/money";
import { getPwaApi } from "@/data/pwa/api";
import { assignMoveWithOfflineFallback } from "@/data/pwa/offline-operations";
import { isOffline } from "@/data/pwa/offline-nav";
import { GestionarOfflineState, gestionarIsOffline } from "@/components/cash/gestionar-offline";
import { type AssignAttempt, assignAttemptFor, assignErrorMessage } from "@/components/cash/assign-attempt";

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

/** Server default page size for GET /cash/sessions. */
const CLOSED_PAGE = 50;

export default function GestionarCajasPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [orphans, setOrphans] = useState<Array<{ id: string; occurredOn: string; kind: string; method: string; amount: number }>>([]);
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  // Closed cajas come in server pages (cursor = last id); «Cargar más» asks
  // for the next one while the last page was full.
  const [moreClosed, setMoreClosed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const attemptRef = useRef<AssignAttempt | null>(null);

  useEffect(() => {
    if (isOffline()) {
      setOffline(true);
      return;
    }
    const api = getPwaApi();
    // M5: the list is paginated server-side. Every pending (open) caja must be
    // shown, so fetch open ones at the max page size and only the most recent
    // closed page; merge by id.
    void Promise.all([
      api.cash.listSessions("open", { limit: 200 }),
      api.cash.listSessions("closed"),
    ])
      .then(([open, closed]) => {
        setMoreClosed((closed as Row[]).length >= CLOSED_PAGE);
        const seen = new Set<string>();
        const merged = [...(open as Row[]), ...(closed as Row[])].filter((row) =>
          seen.has(row.id) ? false : (seen.add(row.id), true),
        );
        setRows(merged);
      })
      .catch((e: unknown) => {
        if (gestionarIsOffline(false, e)) setOffline(true);
        else setError(errorText(e, "No se pudieron cargar las cajas."));
      });
    void api.cash.unassigned().then((data) => setOrphans(data as typeof orphans)).catch(() => setOrphans([]));
  }, []);

  async function loadMoreClosed() {
    const last = rows?.filter((row) => row.regularized).at(-1);
    if (!last || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = (await getPwaApi().cash.listSessions("closed", { limit: CLOSED_PAGE, cursor: last.id })) as Row[];
      setRows((current) => {
        const seen = new Set((current ?? []).map((row) => row.id));
        return [...(current ?? []), ...page.filter((row) => !seen.has(row.id))];
      });
      setMoreClosed(page.length >= CLOSED_PAGE);
    } catch {
      setMoreError("No se pudieron cargar más cajas. Intenta de nuevo.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function assign(moveId: string) {
    if (!target || assigningId) return;
    const attempt = assignAttemptFor(attemptRef.current, moveId, target);
    attemptRef.current = attempt;
    setAssigningId(moveId);
    setAssignError(null);
    try {
      await assignMoveWithOfflineFallback(attempt.moveId, attempt.target, attempt.requestId);
      attemptRef.current = null;
      setOrphans((list) => list.filter((row) => row.id !== moveId));
    } catch (e: unknown) {
      setAssignError(assignErrorMessage(e));
    } finally {
      setAssigningId(null);
    }
  }

  const pending = rows?.filter((row) => !row.regularized) ?? [];
  const closed = rows?.filter((row) => row.regularized) ?? [];

  const ago = (n: number) => (n <= 0 ? "hoy" : n === 1 ? "hace 1 día" : `hace ${n} días`);

  return (
    <div className="flex flex-col pb-6">
      <HeroBlock
        size="medium"
        back={{ href: "/mas/caja", label: "Volver a Caja" }}
        title="Gestionar cajas"
        offline={offline ? { text: "Sin conexión" } : null}
        subtitle={offline ? undefined : rows ? (pending.length === 1 ? "1 pendiente" : `${pending.length} pendientes`) : undefined}
      />
      <Sheet>
        {offline ? <GestionarOfflineState /> : null}
        {!offline && error ? <StateBlock kind="error" title="No se pudieron cargar las cajas." body={error} /> : null}
        {!offline && !rows && !error ? <SkeletonRows /> : null}
        {!offline && rows ? (
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
                        onChange={(e) => {
                        setTarget(e.target.value);
                        setAssignError(null);
                      }}
                    >
                      <option value="">Elige la caja</option>
                      {pending.map((row) => (
                        <option key={row.id} value={row.id}>
                          Caja del {shortDay(row.localDate)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {assignError ? (
                  <p role="alert" className="text-sm text-danger">
                    {assignError}
                  </p>
                ) : null}
                <RowGroup label="Movimientos sin caja">
                  {orphans.map((move) => (
                    <UiRow
                      key={move.id}
                      title={`${kindLabel(move.kind)} · ${move.method}`}
                      meta={shortDay(move.occurredOn)}
                      trailing={
                        <>
                          <span className="text-[15px] font-semibold tabular-nums">{formatCop(move.amount)}</span>
                          <button
                            type="button"
                            className="min-h-11 text-xs font-semibold text-ink underline underline-offset-2 disabled:opacity-40"
                            disabled={!target || assigningId !== null}
                            aria-busy={assigningId === move.id}
                            onClick={() => void assign(move.id)}
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
                      title={`Caja del ${shortDay(row.localDate)} · ${ago(row.ageDays)}`}
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
                      <UiRow key={row.id} title={`Caja del ${shortDay(row.localDate)}`} meta="Cerrada" />
                    ))}
                  </RowGroup>
                )
              ) : null}
              {showClosed && moreClosed ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loadingMore}
                  onClick={() => void loadMoreClosed()}
                  className="w-full"
                >
                  {loadingMore ? "Cargando…" : "Cargar más"}
                </Button>
              ) : null}
              {showClosed && moreError ? (
                <p className="text-sm text-danger">{moreError}</p>
              ) : null}
            </section>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}
