"use client";

import { useSync } from "@/store/syncStore";
import {
  SyncOperationList,
  formatDateTime,
  timeAgo,
  useSyncItems,
} from "./sync-items";

export function SyncCenter() {
  const {
    online,
    counts,
    flushing,
    lastDoneAt,
    lastResult,
    recent,
    centerOpen,
    closeCenter,
    syncNow,
  } = useSync();
  const { items, loading } = useSyncItems();

  if (!centerOpen) return null;

  const synced = lastResult?.synced ?? 0;
  const progress =
    flushing && flushing.total > 0
      ? Math.min(100, Math.round((flushing.completed / flushing.total) * 100))
      : 0;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Centro de sincronización"
      className="fixed inset-x-0 bottom-0 z-[60] mx-auto max-h-[80dvh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-ink/10 bg-surface p-5 shadow-2xl"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Sincronización</h2>
          {!online ? (
            <p className="mt-1 text-sm leading-snug text-ink/60">
              Sin conexión. Las operaciones nuevas se guardarán en este
              dispositivo y se sincronizarán automáticamente al volver
              internet.
            </p>
          ) : (
            <p className="mt-1 text-sm leading-snug text-ink/60">
              {counts.total === 0 && !flushing
                ? "Todo está sincronizado."
                : "Guardado local y sincronización con el servidor."}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={closeCenter}
          aria-label="Cerrar centro de sincronización"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[14px] border border-ink/10 bg-bg text-lg"
        >
          ×
        </button>
      </div>

      <div className="mt-4 rounded-2xl border border-ink/10 bg-bg p-3 text-sm">
        <p>✓ {synced} sincronizada{synced === 1 ? "" : "s"} (último ciclo)</p>
        <p className="mt-1">
          {flushing ? `↻ Sincronizando ${flushing.completed}/${flushing.total}` : `○ ${counts.pending + counts.active} pendiente${counts.pending + counts.active === 1 ? "" : "s"}`}
        </p>
        <p className="mt-1">
          {counts.permanent > 0
            ? `! ${counts.permanent} necesita${counts.permanent === 1 ? "" : "n"} atención`
            : "! 0 necesitan atención"}
        </p>
        {lastDoneAt && (
          <p className="mt-2 text-xs text-ink/55">
            Última sincronización: {formatDateTime(lastDoneAt)}
          </p>
        )}
      </div>

      {flushing && flushing.total > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs font-medium text-ink/55">
            <span>
              {flushing.completed} de {flushing.total}
            </span>
            <span>{progress}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
            <div
              className="h-full rounded-full bg-cta transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {online && counts.total > 0 && !flushing && (
        <button
          type="button"
          onClick={() => void syncNow()}
          className="mt-4 min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white"
        >
          Sincronizar ahora
        </button>
      )}

      <h3 className="mb-2 mt-5 text-sm font-semibold">Operaciones</h3>
      {loading ? (
        <p className="text-sm text-ink/60">Cargando…</p>
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
                className="flex items-center justify-between gap-2 rounded-2xl border border-ink/[0.08] bg-bg px-3 py-2 text-xs text-ink/70"
              >
                <span className="truncate">
                  {r.status === "synced" ? "✓" : "!"} {r.entity ?? "Operación"}
                  {r.operation ? ` · ${r.operation}` : ""}
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
