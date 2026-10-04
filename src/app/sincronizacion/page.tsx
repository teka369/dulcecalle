"use client";

import Link from "next/link";
import { useSync } from "@/store/syncStore";
import { SyncOperationList, useSyncItems } from "@/components/shell/sync-items";
import { SyncStatusSummary } from "@/components/shell/SyncStatusSummary";
import { DISCARD_NOTICE } from "@/data/pwa/sync-copy";
import { Button } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Spinner } from "@/components/ui/Spinner";

export default function SincronizacionPage() {
  const { online, counts, flushing, lastDoneAt, authRequired, syncNow } = useSync();
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
        <h1 className="text-[22px] font-semibold">Datos y sincronización</h1>
      </header>

      <section className="text-sm leading-snug">
        <p className="font-semibold">Este teléfono</p>
        <p className="mt-1 text-ink-muted">
          Los datos de la tienda abierta se conservan aquí para poder trabajar
          incluso sin conexión.
        </p>
      </section>

      <SyncStatusSummary
        online={online}
        counts={counts}
        flushing={flushing}
        authRequired={authRequired}
        lastDoneAt={lastDoneAt}
      />

      {online && authRequired && (
        <a
          href="/login"
          className="flex min-h-11 w-full items-center justify-center rounded-[var(--r-md)] bg-cta text-sm font-semibold text-cta-fg"
        >
          Entra para enviar lo guardado aquí
        </a>
      )}

      {online && counts.total > 0 && !flushing && !authRequired && (
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
          title="Nada pendiente"
          description="No hay operaciones por enviar desde este teléfono."
        />
      ) : (
        <SyncOperationList items={items} flushing={flushing != null} />
      )}

      <p className="text-xs leading-relaxed text-ink-muted">{DISCARD_NOTICE}</p>
    </div>
  );
}
