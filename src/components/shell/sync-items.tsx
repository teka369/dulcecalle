"use client";

import Link from "next/link";

import { PendingBadge } from "@/components/ui/StatusBadge";
import { useCallback, useEffect, useRef, useState } from "react";
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

export function useSyncItems() {
  const [items, setItems] = useState<EnrichedTrayItem[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-instance coalescing: the tray and /sincronizacion can be mounted at
  // once; a shared module flag made the second one return early forever.
  const reloadingRef = useRef(false);
  const againRef = useRef(false);

  const reload = useCallback(async () => {
    const businessId = sessionBusinessId();
    if (!businessId) {
      setItems([]);
      setLoading(false);
      return;
    }
    // Coalesce bursts (e.g. one Dexie read per sync item event).
    if (reloadingRef.current) {
      againRef.current = true;
      return;
    }
    reloadingRef.current = true;
    try {
      do {
        againRef.current = false;
        try {
          setItems(await listEnrichedTray(businessId));
        } catch {
          /* keep previous list; counts still come from the store */
        }
      } while (againRef.current);
    } finally {
      reloadingRef.current = false;
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
  // An orphan will never be sent on its own: say so instead of «Guardada aquí».
  if (item.orphaned) {
    return <Badge tone="danger" className="shrink-0">! No se puede enviar</Badge>;
  }
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
  const discardTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);

  // Focus moves into the confirmation when it opens and back to «Descartar» when it closes.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) discardTriggerRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

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
            <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              {!item.orphaned && <PendingBadge label="En espera" />}
              {item.blockedBy}
            </span>
          )}
        </span>
        <StatusChip item={item} flushing={flushing} />
      </button>

      {item.status === "failed" && reason && !item.orphanNote && (
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

      {item.orphanNote && (
        <p className="mt-2 text-sm text-ink-muted">{item.orphanNote}</p>
      )}

      {item.correction && !item.orphanNote && !confirming && (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-ink-muted">{item.correction.note}</p>
          {item.correction.href && (
            <Link
              href={item.correction.href}
              className="flex min-h-11 w-full items-center justify-center rounded-[var(--r-md)] border border-border bg-surface px-4 text-sm font-semibold"
            >
              Corregir
            </Link>
          )}
        </div>
      )}

      {(item.status === "failed" || item.orphaned) && !confirming && (
        <div className={`mt-3 grid gap-2 ${item.canRetry ? "grid-cols-2" : "grid-cols-1"}`}>
          {item.canRetry && (
            <Button type="button" variant="primary" disabled={busy} onClick={() => void retry()} className="w-full">
              Reintentar
            </Button>
          )}
          <Button ref={discardTriggerRef} type="button" variant="secondary" disabled={busy} onClick={() => setConfirming(true)} className="w-full text-ink-muted">
            Descartar
          </Button>
        </div>
      )}

      {(item.status === "failed" || item.orphaned) && confirming && (
        <div
          ref={confirmRef}
          role="alertdialog"
          tabIndex={-1}
          aria-labelledby={`discard-title-${item.operationId}`}
          aria-describedby={`discard-desc-${item.operationId}`}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) {
              e.preventDefault();
              setConfirming(false);
              return;
            }
            if (e.key !== "Tab") return;
            // Focus trap: Tab / Shift+Tab cycle between the dialog's enabled buttons.
            const focusables = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled])"),
            );
            if (focusables.length === 0) {
              e.preventDefault();
              return;
            }
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            const active = document.activeElement;
            if (e.shiftKey && (active === first || active === e.currentTarget)) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && active === last) {
              e.preventDefault();
              first.focus();
            }
          }}
          className="mt-3 rounded-[var(--r-lg)] border border-danger/20 bg-danger/5 p-3 outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          <p id={`discard-title-${item.operationId}`} className="text-sm font-semibold">¿Descartar este envío?</p>
          <p id={`discard-desc-${item.operationId}`} className="mt-1 text-xs leading-relaxed text-ink-muted">{DISCARD_NOTICE}</p>
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
