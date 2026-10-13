"use client";

import { useSync } from "@/store/syncStore";
import { SyncOperationList, useSyncItems } from "@/components/shell/sync-items";
import { SyncStatusSummary } from "@/components/shell/SyncStatusSummary";
import { StorageProtectionCard } from "@/components/shell/StorageProtectionCard";
import { DISCARD_NOTICE } from "@/data/pwa/sync-copy";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { HeroPill } from "@/components/ui/HeroPill";
import { Sheet } from "@/components/ui/Sheet";
import { SectionHead } from "@/components/ui/SectionHead";
import { StateBlock } from "@/components/ui/StateBlock";
import { SkeletonRows } from "@/components/ui/Skeleton";

export default function SincronizacionPage() {
  const { online, counts, flushing, lastDoneAt, authRequired, syncNow } = useSync();
  const { items, loading } = useSyncItems();
  const canSync = online && counts.total > 0 && !flushing && !authRequired;

  return (
    <div className="flex flex-col">
      <HeroBlock
        size="medium"
        back={{ href: "/", label: "Volver" }}
        title="Datos y sincronización"
        subtitle={`Este teléfono · ${counts.total} ${counts.total === 1 ? "pendiente" : "pendientes"}`}
        offline={online ? null : { text: "Sin conexión · Lo guardado aquí se enviará cuando vuelva la conexión." }}
        busy={flushing != null}
        action={canSync ? <HeroPill primary label="Sincronizar ahora" onClick={() => void syncNow()} /> : undefined}
      />
      <Sheet>
        <p className="text-sm leading-snug text-ink-muted">
          Los datos de la tienda abierta se conservan aquí para poder trabajar incluso sin conexión.
        </p>
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
        <section className="flex flex-col gap-2">
          <SectionHead title="Operaciones" />
          {loading ? (
            <div aria-busy="true">
              <SkeletonRows rows={3} />
            </div>
          ) : items.length === 0 ? (
            <StateBlock kind="empty" title="Nada pendiente" body="No hay operaciones por enviar desde este teléfono." />
          ) : (
            <SyncOperationList items={items} flushing={flushing != null} />
          )}
        </section>
        <StorageProtectionCard />
        <p className="text-xs leading-relaxed text-ink-muted">{DISCARD_NOTICE}</p>
      </Sheet>
    </div>
  );
}
