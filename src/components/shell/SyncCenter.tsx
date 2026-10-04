"use client";

import { useSync } from "@/store/syncStore";
import { usePrep } from "@/store/prepStore";
import { activityLabel } from "@/data/pwa/sync-tray";
import {
  SyncOperationList,
  formatDateTime,
  timeAgo,
  useSyncItems,
} from "./sync-items";
import { SyncStatusSummary } from "./SyncStatusSummary";

export function SyncCenter() {
  const {
    online,
    counts,
    flushing,
    lastDoneAt,
    recent,
    centerOpen,
    authRequired,
    closeCenter,
    syncNow,
  } = useSync();
  const { phase: prepPhase, lastReadyAt: prepReadyAt } = usePrep();
  const { items, loading } = useSyncItems();

  if (!centerOpen) return null;

  const progress =
    flushing && flushing.total > 0
      ? Math.min(100, Math.round((flushing.completed / flushing.total) * 100))
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Datos y sincronización"
      className="fixed inset-x-0 bottom-0 z-[60] mx-auto max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-[var(--r-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-lg)]"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold">Datos y sincronización</h2>
        <button
          type="button"
          onClick={closeCenter}
          aria-label="Cerrar datos y sincronización"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--r-md)] border border-border bg-bg text-lg"
        >
          ×
        </button>
      </div>

      <SyncStatusSummary
        online={online}
        counts={counts}
        flushing={flushing}
        authRequired={authRequired}
        lastDoneAt={lastDoneAt}
      />

      {prepPhase === "ready" && prepReadyAt && (
        <p className="mt-2 text-xs text-ink-muted">
          Listo para trabajar sin conexión desde {formatDateTime(prepReadyAt)}
        </p>
      )}

      {flushing && flushing.total > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium text-ink-muted">
            <span>
              {flushing.completed} de {flushing.total}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-cta transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {online && authRequired && (
        <a
          href="/login"
          className="mt-4 flex min-h-11 w-full items-center justify-center rounded-[var(--r-md)] bg-cta text-sm font-semibold text-cta-fg"
        >
          Entra para enviar lo guardado aquí
        </a>
      )}

      {online && counts.total > 0 && !flushing && !authRequired && (
        <button
          type="button"
          onClick={() => void syncNow()}
          className="mt-4 min-h-11 w-full rounded-[var(--r-md)] bg-cta text-sm font-semibold text-cta-fg"
        >
          Sincronizar ahora
        </button>
      )}

      <h3 className="mb-2 mt-5 text-sm font-semibold">Operaciones</h3>
      {loading ? (
        <p className="text-sm text-ink-muted">Cargando…</p>
      ) : (
        <SyncOperationList items={items} flushing={flushing != null} />
      )}

      {recent.length > 0 && (
        <>
          <h3 className="mb-2 mt-5 text-sm font-semibold">Actividad reciente</h3>
          <ul className="flex flex-col gap-2">
            {recent.map((r) => (
              <li
                key={r.key}
                className="flex items-center justify-between gap-2 rounded-[var(--r-lg)] border border-border bg-bg px-3 py-2 text-xs text-ink-muted"
              >
                <span className="truncate">
                  {r.status === "synced" ? "✓" : "!"} {activityLabel(r.entity, r.operation)}
                </span>
                <span className="shrink-0">{timeAgo(r.at)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
