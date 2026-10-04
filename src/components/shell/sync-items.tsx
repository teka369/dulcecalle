"use client";

import { useCallback, useEffect, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import {
  describeOutboxDetail,
  describeOutboxOperation,
  discardOutboxOperation,
  humanizeSyncError,
  listEnrichedTray,
  retryOutboxOperation,
  type EnrichedTrayItem,
} from "@/data/pwa/sync-tray";
import { syncStore } from "@/store/syncStore";
import { DISCARD_NOTICE, formatDateTime, syncOperationNotes } from "@/data/pwa/sync-copy";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export { formatDateTime };

export function timeAgo(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 5) return "ahora mismo";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  return formatDateTime(at);
}

function sessionBusinessId(): string | null {
  try {
    return getPwaAuthSession().businessId;
  } catch {
    return null;
  }
}

let reloading = false;

export function useSyncItems() {
  const [items, setItems] = useState<EnrichedTrayItem[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const businessId = sessionBusinessId();
    if (!businessId) {
      setItems([]);
      setLoading(false);
      return;
    }
    // Coalesce bursts (e.g. one Dexie read per sync item event).
    if (reloading) return;
    reloading = true;
    try {
      setItems(await listEnrichedTray(businessId));
    } catch {
      /* keep previous list; counts still come from the store */
    } finally {
      reloading = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return syncStore.subscribe(() => {
      void reload();
    });
  }, [reload]);

  return { items, loading, reload };
}

function StatusChip({ item, flushing }: { item: EnrichedTrayItem; flushing: boolean }) {
  if (item.status === "failed" && item.permanent) {
    return <Badge tone="danger" className="shrink-0">! Necesita atención</Badge>;
  }
  if (item.status === "failed") {
    return <Badge tone="danger" className="shrink-0">! Reintentando</Badge>;
  }
  // in_flight rows with no active flush (e.g. after a reload while
  // offline) resume on the next cycle; never show them as stuck.
  if (item.status === "in_flight" && flushing) {
    return <Badge tone="warning" className="shrink-0">↑ Enviando</Badge>;
  }
  return <Badge tone="info" className="shrink-0">○ Guardada aquí</Badge>;
}

export function SyncOperationRow({ item, flushing }: { item: EnrichedTrayItem; flushing: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detail = describeOutboxDetail(item);
  const reason = humanizeSyncError(item.lastError);

  async function retry() {
    const businessId = sessionBusinessId();
    if (!businessId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await retryOutboxOperation(businessId, item.operationId);
      await syncStore.syncNow();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reintentar.");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    const businessId = sessionBusinessId();
    if (!businessId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await discardOutboxOperation(businessId, item.operationId);
      setConfirming(false);
      await syncStore.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descartar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-[var(--r-lg)] border border-border bg-surface p-4 shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">
            {describeOutboxOperation(item.entity, item.operation)}
          </span>
          {detail && (
            <span className="mt-0.5 block truncate text-xs text-ink-muted">{detail}</span>
          )}
          {item.blockedBy && (
            <span className="mt-1 block text-xs font-medium text-ink-muted">
              ⏳ {item.blockedBy}
            </span>
          )}
        </span>
        <StatusChip item={item} flushing={flushing} />
      </button>

      {item.status === "failed" && reason && (
        <p className="mt-2 text-sm text-danger">
          <span className="font-semibold">Motivo: </span>
          {reason}
        </p>
      )}

      {expanded && (
        <div className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-ink-muted">
          {syncOperationNotes(item).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      {item.status === "failed" && !confirming && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button type="button" variant="primary" disabled={busy} onClick={() => void retry()} className="w-full">
            Reintentar
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(true)} className="w-full text-ink-muted">
            Descartar
          </Button>
        </div>
      )}

      {item.status === "failed" && confirming && (
        <div className="mt-3 rounded-[var(--r-lg)] border border-danger/20 bg-danger/5 p-3">
          <p className="text-sm font-semibold">¿Descartar este envío?</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{DISCARD_NOTICE}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(false)} className="w-full">
              Cancelar
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => void discard()} className="w-full">
              Descartar
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </li>
  );
}

export function SyncOperationList({ items, flushing }: { items: EnrichedTrayItem[]; flushing: boolean }) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-ink-muted">No hay operaciones pendientes.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <SyncOperationRow key={item.operationId} item={item} flushing={flushing} />
      ))}
    </ul>
  );
}
