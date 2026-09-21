"use client";

import { useCallback, useEffect, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import {
  describeOutboxDetail,
  describeOutboxOperation,
  describeTrayStatus,
  discardOutboxOperation,
  humanizeSyncError,
  isPermanentFailure,
  listEnrichedTray,
  retryOutboxOperation,
  type EnrichedTrayItem,
} from "@/data/pwa/sync-tray";
import { syncStore } from "@/store/syncStore";

export function formatDateTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
    return (
      <span className="shrink-0 rounded-full bg-danger/10 px-2 py-1 text-xs font-semibold text-danger">
        ! Necesita atención
      </span>
    );
  }
  if (item.status === "failed") {
    return (
      <span className="shrink-0 rounded-full bg-danger/10 px-2 py-1 text-xs font-semibold text-danger">
        ! Reintentando
      </span>
    );
  }
  // in_flight rows with no active flush (e.g. after a reload while
  // offline) resume on the next cycle; never show them as stuck.
  if (item.status === "in_flight" && flushing) {
    return (
      <span className="shrink-0 rounded-full bg-primary/20 px-2 py-1 text-xs font-semibold text-ink">
        ↻ Sincronizando
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-ink/10 px-2 py-1 text-xs font-semibold text-ink/70">
      ○ Pendiente
    </span>
  );
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
    <li className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
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
            <span className="mt-0.5 block truncate text-xs text-ink/60">{detail}</span>
          )}
          {item.blockedBy && (
            <span className="mt-1 block text-xs font-medium text-ink/70">
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
        <div className="mt-3 space-y-1 border-t border-ink/10 pt-3 text-xs text-ink/60">
          <p>Estado: {describeTrayStatus(item.status)}</p>
          <p>Creada: {formatDateTime(item.localCreatedAt)}</p>
          <p>Intentos: {item.attempts}</p>
          {item.status === "failed" && !isPermanentFailure(item) && (
            <p>Se reintentará automáticamente.</p>
          )}
          {item.status === "failed" && isPermanentFailure(item) && (
            <p>Qué puedes hacer: revisa el motivo y reintenta si corresponde.</p>
          )}
          <details>
            <summary className="cursor-pointer font-medium">Información técnica</summary>
            <p className="mt-1 break-all">requestId: {item.requestId}</p>
          </details>
        </div>
      )}

      {item.status === "failed" && !confirming && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void retry()}
            className="min-h-11 rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
          >
            Reintentar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="min-h-11 rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold text-ink/70 disabled:opacity-40"
          >
            Descartar
          </button>
        </div>
      )}

      {item.status === "failed" && confirming && (
        <div className="mt-3 rounded-2xl border border-danger/20 bg-danger/5 p-3">
          <p className="text-sm font-semibold">¿Descartar esta operación?</p>
          <p className="mt-1 text-xs leading-relaxed text-ink/70">
            Se eliminará la intención pendiente de este dispositivo. Esto no
            revierte una operación que ya hubiera llegado al servidor.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="min-h-11 rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void discard()}
              className="min-h-11 rounded-[14px] bg-danger text-sm font-semibold text-white disabled:opacity-40"
            >
              Descartar
            </button>
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
      <p className="text-sm text-ink/60">No hay operaciones pendientes.</p>
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
