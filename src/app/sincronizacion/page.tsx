"use client";

import Link from "next/link";
import { useSync } from "@/store/syncStore";
import { SyncOperationList, formatDateTime, useSyncItems } from "@/components/shell/sync-items";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Empty } from "@/components/ui/Empty";
import { Spinner } from "@/components/ui/Spinner";

export default function SincronizacionPage() {
  const { online, counts, flushing, lastDoneAt, syncNow } = useSync();
  const { items, loading } = useSyncItems();

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--r-md)] border border-border bg-surface text-lg shadow-[var(--shadow-sm)]"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Sincronización</h1>
      </header>

      {!online && (
        <Card className="px-4 py-3 text-sm">
          <p className="font-semibold">Sin conexión</p>
          <p className="mt-1 text-ink-muted">
            Las operaciones nuevas se guardarán en este dispositivo y se
            sincronizarán automáticamente al volver internet.
          </p>
        </Card>
      )}

      <Card className="text-sm">
        <p>
          ○ {counts.pending + counts.active} pendiente{(counts.pending + counts.active) === 1 ? "" : "s"}
        </p>
        <p className="mt-1">
          {counts.permanent > 0
            ? `! ${counts.permanent} necesita${counts.permanent === 1 ? "" : "n"} atención`
            : "! 0 necesitan atención"}
        </p>
        {lastDoneAt && (
          <p className="mt-2 text-xs text-ink-muted">
            Última sincronización: {formatDateTime(lastDoneAt)}
          </p>
        )}
      </Card>

      {online && counts.total > 0 && (
        <Button type="button" variant="primary" onClick={() => void syncNow()} className="w-full">
          Sincronizar ahora
        </Button>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Empty
          title="Todo al día"
          description="No hay operaciones pendientes ni errores de sincronización."
        />
      ) : (
        <SyncOperationList items={items} flushing={flushing != null} />
      )}

      {items.length > 0 && (
        <p className="text-xs leading-relaxed text-ink-muted">
          Descartar elimina el pendiente de este dispositivo. No deshace nada
          que ya esté guardado en el servidor.
        </p>
      )}
    </div>
  );
}
