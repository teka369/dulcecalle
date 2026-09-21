"use client";

import Link from "next/link";
import { useSync } from "@/store/syncStore";
import { SyncOperationList, formatDateTime, useSyncItems } from "@/components/shell/sync-items";

export default function SincronizacionPage() {
  const { online, counts, flushing, lastDoneAt, syncNow } = useSync();
  const { items, loading } = useSyncItems();

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Sincronización</h1>
      </header>

      {!online && (
        <div className="rounded-2xl border border-ink/10 bg-surface px-4 py-3 text-sm">
          <p className="font-semibold">Sin conexión</p>
          <p className="mt-1 text-ink/60">
            Las operaciones nuevas se guardarán en este dispositivo y se
            sincronizarán automáticamente al volver internet.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4 text-sm">
        <p>
          ○ {counts.pending + counts.active} pendiente{(counts.pending + counts.active) === 1 ? "" : "s"}
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
      </section>

      {online && counts.total > 0 && (
        <button
          type="button"
          onClick={() => void syncNow()}
          className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white"
        >
          Sincronizar ahora
        </button>
      )}

      {loading ? (
        <p className="text-sm text-ink/60">Cargando…</p>
      ) : items.length === 0 ? (
        <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <p className="text-sm font-semibold">Todo al día</p>
          <p className="mt-1 text-sm text-ink/60">
            No hay operaciones pendientes ni errores de sincronización.
          </p>
        </section>
      ) : (
        <SyncOperationList items={items} flushing={flushing != null} />
      )}

      {items.length > 0 && (
        <p className="text-xs leading-relaxed text-ink/60">
          Descartar elimina el pendiente de este dispositivo. No deshace nada
          que ya esté guardado en el servidor.
        </p>
      )}
    </div>
  );
}
