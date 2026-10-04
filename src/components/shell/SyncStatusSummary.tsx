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
    <div className="mt-4 rounded-[var(--r-lg)] border border-border bg-bg p-3 text-sm">
      <p className="leading-snug">{copy.lead}</p>
      <p className="mt-3 font-semibold">En el servidor</p>
      <p className="mt-0.5 leading-snug text-ink-muted">{copy.server}</p>
      <p className="mt-3 font-semibold">Guardado solo aquí</p>
      <p className="mt-0.5 leading-snug text-ink-muted">{copy.device}</p>
      <p className="mt-3 font-semibold">Hace falta atención</p>
      <p className={`mt-0.5 leading-snug ${counts.permanent > 0 ? "text-danger" : "text-ink-muted"}`}>
        {copy.attention}
      </p>
      <p className="mt-3 text-xs text-ink-muted">{lastCompletedSyncLine(lastDoneAt, clear)}</p>
      <p className="mt-1 text-xs text-ink-muted">{NOT_A_BACKUP}</p>
    </div>
  );
}
