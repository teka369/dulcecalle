"use client";

import {
  NOT_A_BACKUP,
  lastCompletedSyncLine,
  queueIsClear,
  syncPlaceCopy,
} from "@/data/pwa/sync-copy";
import type { SyncCounts } from "@/store/syncStore";

export function SyncStatusSummary({
  online,
  counts,
  flushing,
  authRequired,
  lastDoneAt,
}: {
  online: boolean;
  counts: SyncCounts;
  flushing: { completed: number; total: number } | null;
  authRequired: boolean;
  lastDoneAt: number | null;
}) {
  const copy = syncPlaceCopy({ online, authRequired, flushing, counts });
  const clear = queueIsClear({ counts, flushing, authRequired });
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="leading-snug">{copy.lead}</p>
      <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--r-lg)] border border-border bg-border min-[420px]:grid-cols-3" aria-label="Estado de sincronización">
        <li className="bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">En el servidor</p>
          <p className="mt-1 leading-snug text-ink">{copy.server}</p>
        </li>
        <li className="bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Guardado solo aquí</p>
          <p className="mt-1 leading-snug text-ink">{copy.device}</p>
        </li>
        <li className="bg-surface p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Hace falta atención</p>
          <p className={`mt-1 leading-snug ${counts.permanent > 0 ? "text-danger" : "text-ink"}`}>{copy.attention}</p>
        </li>
      </ul>
      <p className="text-xs text-ink-muted">{lastCompletedSyncLine(lastDoneAt, clear)}</p>
      <p className="text-xs text-ink-muted">{NOT_A_BACKUP}</p>
    </div>
  );
}
