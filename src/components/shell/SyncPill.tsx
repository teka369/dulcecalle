"use client";

import { usePathname } from "next/navigation";
import { useSync, type SyncCounts } from "@/store/syncStore";

const HIDDEN_PREFIXES = ["/cliente", "/login", "/register"];

export function syncPillLabel(
  online: boolean,
  counts: SyncCounts,
  flushing: { completed: number; total: number } | null,
  authRequired = false,
): string {
  if (!online) {
    return counts.total > 0 ? `○ Sin conexión · ${counts.total} pendientes` : "○ Sin conexión";
  }
  if (authRequired) {
    return "Inicia sesión para sincronizar";
  }
  if (flushing && flushing.total > 0) {
    return `↻ Sincronizando ${Math.min(flushing.completed, flushing.total)}/${flushing.total}`;
  }
  if (counts.permanent > 0) {
    return `! ${counts.permanent} necesita${counts.permanent === 1 ? "" : "n"} atención`;
  }
  if (counts.total > 0) {
    return `${counts.total} pendiente${counts.total === 1 ? "" : "s"}`;
  }
  return "✓ Sincronizado";
}

export function SyncPill() {
  const pathname = usePathname();
  const { online, counts, flushing, authRequired, openCenter } = useSync();

  if (HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const label = syncPillLabel(online, counts, flushing, authRequired);
  const tone = !online
    ? "border-ink/10 bg-surface text-ink/70"
    : authRequired
      ? "border-danger/30 bg-surface text-danger"
      : flushing && flushing.total > 0
        ? "border-primary/30 bg-surface text-ink"
        : counts.permanent > 0
          ? "border-danger/30 bg-surface text-danger"
          : counts.total > 0
            ? "border-ink/10 bg-surface text-ink/70"
            : "border-ok/25 bg-surface text-ink/60";

  return (
    <button
      type="button"
      onClick={openCenter}
      aria-label={`Sincronización: ${label}. Abrir centro de sincronización.`}
      className={`fixed bottom-[4.5rem] left-4 z-50 flex min-h-11 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg ${tone}`}
    >
      <span className="truncate">{label}</span>
    </button>
  );
}
