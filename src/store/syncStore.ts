"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { getLocalDb } from "@/data/local/db";
import type { SyncFlushResult } from "@/data/local/outbox";
import {
  readLastCompletedSync,
  writeLastCompletedSync,
} from "@/data/pwa/last-completed-sync";
import { syncAllPending } from "@/data/pwa/sync-coordinator";

export type SyncCounts = {
  pending: number;
  active: number;
  failed: number;
  permanent: number;
  total: number;
};

export type RecentSyncItem = {
  key: string;
  entity?: string;
  operation?: string;
  status: "synced" | "failed";
  at: number;
  message?: string;
};

type SyncUiState = {
  online: boolean;
  counts: SyncCounts;
  /** Live cycle progress aggregated across sequential flushes. Null when idle. */
  flushing: { completed: number; total: number } | null;
  lastDoneAt: number | null;
  lastResult: SyncFlushResult | null;
  recent: RecentSyncItem[];
  centerOpen: boolean;
  /** Bumped whenever Dexie-derived data may have changed. */
  itemsVersion: number;
  /** 401 during flush: outbox is intact; user must sign in again. */
  authRequired: boolean;
};

const EMPTY_COUNTS: SyncCounts = { pending: 0, active: 0, failed: 0, permanent: 0, total: 0 };

function initialState(): SyncUiState {
  return {
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    counts: EMPTY_COUNTS,
    flushing: null,
    lastDoneAt: null,
    lastResult: null,
    recent: [],
    centerOpen: false,
    itemsVersion: 0,
    authRequired: false,
  };
}

const listeners = new Set<() => void>();

let state: SyncUiState = initialState();

// Aggregates one connectivity cycle (the coordinator runs several
// sequential flushes: sales, payments, catalog, operations). Reset only
// after an idle gap so progress never jumps backwards mid-cycle.
let activeFlushes = 0;
let cycleCompleted = 0;
let cycleTotal = 0;
let lastStartAt = 0;
let recentKey = 0;

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<SyncUiState>) {
  state = { ...state, ...patch };
  emit();
}

function businessId(): string | null {
  try {
    return getPwaAuthSession().businessId;
  } catch {
    return null;
  }
}

async function refreshCounts(): Promise<boolean> {
  const id = businessId();
  if (!id) {
    setState({ counts: EMPTY_COUNTS, lastDoneAt: null });
    return true;
  }
  try {
    const db = getLocalDb();
    const [pending, active, failed] = await Promise.all([
      db.outbox.where("[businessId+status]").equals([id, "pending"]).toArray(),
      db.outbox.where("[businessId+status]").equals([id, "in_flight"]).toArray(),
      db.outbox.where("[businessId+status]").equals([id, "failed"]).toArray(),
    ]);
    if (businessId() !== id) return false;
    const permanent = failed.filter((row) => row.nextAttemptAt == null).length;
    const lastDoneAt = readLastCompletedSync(id);
    setState({
      counts: {
        pending: pending.length,
        active: active.length,
        failed: failed.length,
        permanent,
        total: pending.length + active.length + failed.length,
      },
      lastDoneAt,
      itemsVersion: state.itemsVersion + 1,
    });
    return true;
  } catch {
    /* IndexedDB unavailable: keep last known counts */
    return false;
  }
}

/**
 * A cycle counts as completed only when the flush that just went idle did
 * not fail, block, or stop, and this shop has nothing left to send.
 * A dirty cycle must not move the clock.
 */
async function maybeRememberCompleted(result: SyncFlushResult | undefined): Promise<void> {
  if (!result || result.authRequired || result.failed > 0 || result.blocked > 0 || result.stopped) {
    return;
  }
  const ok = await refreshCounts();
  if (!ok || activeFlushes !== 0 || state.authRequired) return;
  if (state.counts.total !== 0 || state.counts.permanent !== 0) return;
  const id = businessId();
  if (!id) return;
  const at = Date.now();
  writeLastCompletedSync(id, at);
  if (businessId() === id) setState({ lastDoneAt: at });
}

type SyncEventDetail = {
  type: "start" | "item" | "done" | "queued" | "auth-required";
  businessId?: string;
  total?: number;
  completed?: number;
  entity?: string;
  operation?: string;
  status?: "synced" | "failed";
  message?: string;
  result?: SyncFlushResult;
};

function onSyncEvent(event: Event): void {
  const detail = (event as CustomEvent<SyncEventDetail>).detail;
  if (!detail) return;
  const id = businessId();
  if (detail.businessId && id && detail.businessId !== id) return;

  if (detail.type === "auth-required") {
    setState({ authRequired: true, flushing: null });
    activeFlushes = 0;
    void refreshCounts();
    return;
  }

  if (detail.type === "start") {
    const now = Date.now();
    if (activeFlushes === 0 || now - lastStartAt > 3000) {
      cycleCompleted = 0;
      cycleTotal = 0;
    }
    lastStartAt = now;
    activeFlushes += 1;
    cycleTotal += detail.total ?? 0;
    setState({
      flushing: { completed: cycleCompleted, total: cycleTotal },
      authRequired: false,
    });
    return;
  }

  if (detail.type === "item") {
    cycleCompleted += 1;
    recentKey += 1;
    const recentStatus: RecentSyncItem["status"] =
      detail.status === "failed" ? "failed" : "synced";
    const recent: RecentSyncItem[] = [
      {
        key: `${Date.now()}-${recentKey}`,
        entity: detail.entity,
        operation: detail.operation,
        status: recentStatus,
        at: Date.now(),
        message: detail.message,
      },
      ...state.recent,
    ].slice(0, 20);
    setState({ recent, flushing: { completed: cycleCompleted, total: cycleTotal } });
    void refreshCounts();
    return;
  }

  if (detail.type === "done") {
    activeFlushes = Math.max(0, activeFlushes - 1);
    const idle = activeFlushes === 0;
    setState({
      lastResult: detail.result ?? null,
      flushing: idle ? null : { completed: cycleCompleted, total: cycleTotal },
      authRequired: detail.result?.authRequired ? true : state.authRequired,
    });
    void refreshCounts();
    if (idle) void maybeRememberCompleted(detail.result);
    return;
  }

  if (detail.type === "queued") {
    void refreshCounts();
  }
}

function onOnline() {
  setState({ online: true });
  void refreshCounts();
}

function onOffline() {
  setState({ online: false, flushing: null });
  activeFlushes = 0;
}

function onFocus() {
  void refreshCounts();
}

let listening = false;

function ensureListening() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  try {
    setState({ online: navigator.onLine });
  } catch {
    /* ignore */
  }
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("dulcecalle:sync", onSyncEvent);
  window.addEventListener("focus", onFocus);
  void refreshCounts();
}

/** Test-only. Does not delete the outbox or the stored clock. */
export function __resetSyncUiForTests(): void {
  activeFlushes = 0;
  cycleCompleted = 0;
  cycleTotal = 0;
  lastStartAt = 0;
  recentKey = 0;
  state = initialState();
}

export const syncStore = {
  subscribe(listener: () => void) {
    ensureListening();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): SyncUiState {
    return state;
  },
  openCenter() {
    setState({ centerOpen: true });
    void refreshCounts();
  },
  closeCenter() {
    setState({ centerOpen: false });
  },
  refresh() {
    return refreshCounts();
  },
  async syncNow(): Promise<void> {
    const id = businessId();
    if (!id || !state.online) return;
    setState({ authRequired: false });
    await syncAllPending(id);
  },
};

export function useSync() {
  const snap = useSyncExternalStore(
    syncStore.subscribe,
    syncStore.getSnapshot,
    syncStore.getSnapshot,
  );
  const sessionBusinessId = readSessionBusinessId();
  useEffect(() => {
    void syncStore.refresh();
  }, [sessionBusinessId]);
  const openCenter = useCallback(() => syncStore.openCenter(), []);
  const closeCenter = useCallback(() => syncStore.closeCenter(), []);
  const refresh = useCallback(() => syncStore.refresh(), []);
  const syncNow = useCallback(() => syncStore.syncNow(), []);
  return { ...snap, openCenter, closeCenter, refresh, syncNow };
}

function readSessionBusinessId(): string | null {
  try {
    return getPwaAuthSession().businessId;
  } catch {
    return null;
  }
}
