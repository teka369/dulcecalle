"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import {
  buildPrepTaskDefs,
  checkReadiness,
  runPreparation,
  type PrepTaskGroup,
} from "@/data/pwa/offline-prep";

export type PrepPhase = "idle" | "preparing" | "ready" | "failed";

export type PrepUiTask = {
  key: string;
  label: string;
  group: PrepTaskGroup;
  status: "pending" | "running" | "done" | "failed";
  error: string | null;
  detail: string | null;
};

type PrepUiState = {
  phase: PrepPhase;
  stale: boolean;
  businessId: string | null;
  tasks: PrepUiTask[];
  completed: number;
  total: number;
  modalOpen: boolean;
  panelOpen: boolean;
  dismissed: boolean;
  lastReadyAt: number | null;
};

const listeners = new Set<() => void>();

let state: PrepUiState = {
  phase: "idle",
  stale: false,
  businessId: null,
  tasks: [],
  completed: 0,
  total: 0,
  modalOpen: false,
  panelOpen: false,
  dismissed: false,
  lastReadyAt: null,
};

function emit() {
  listeners.forEach((l) => l());
}

function setState(patch: Partial<PrepUiState>) {
  state = { ...state, ...patch };
  emit();
}

function sessionBusinessId(): string | null {
  try {
    return getPwaAuthSession().businessId;
  } catch {
    return null;
  }
}

function isOnline(): boolean {
  try {
    return typeof navigator === "undefined" ? true : navigator.onLine;
  } catch {
    return true;
  }
}

function dismissedKey(businessId: string): string {
  return `prep-dismissed::${businessId}`;
}

function readDismissed(businessId: string): boolean {
  try {
    return localStorage.getItem(dismissedKey(businessId)) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(businessId: string): void {
  try {
    localStorage.setItem(dismissedKey(businessId), "1");
  } catch {
    // The in-memory flag still lets this session continue.
  }
}

async function startInternal(businessId: string, refresh: boolean): Promise<void> {
  const dismissed = state.dismissed || readDismissed(businessId);
  const { defs } = await buildPrepTaskDefs(businessId);
  setState({
    phase: "preparing",
    businessId,
    tasks: defs.map((d) => ({ key: d.key, label: d.label, group: d.group, status: "pending" as const, error: null, detail: null })),
    completed: 0,
    total: defs.length,
    modalOpen: !dismissed,
    panelOpen: state.panelOpen,
    dismissed,
    stale: false,
  });
  const row = await runPreparation(businessId, (progress) => {
    setState({
      tasks: state.tasks.map((t) =>
        t.key === progress.key
          ? { ...t, status: progress.status, error: progress.error, detail: progress.detail ?? null }
          : t,
      ),
      completed: progress.completed,
    });
  }, { refresh });
  if (row.status === "ready") {
    setState({ phase: "ready", lastReadyAt: row.completedAt });
  } else {
    setState({ phase: "failed" });
  }
}

let starting: Promise<void> | null = null;

export const prepStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): PrepUiState {
    return state;
  },
  /** Starts preparation unless one is already running. Refresh repeats every dataset. */
  start(options?: { refresh?: boolean }): Promise<void> {
    const businessId = sessionBusinessId();
    if (!businessId || !isOnline()) return Promise.resolve();
    if (starting) return starting;
    starting = startInternal(businessId, options?.refresh === true).finally(() => {
      starting = null;
    });
    return starting;
  },
  /** Starts preparation without blocking the app. The intro stays closed after dismiss. */
  async evaluate(): Promise<void> {
    const businessId = sessionBusinessId();
    if (!businessId || !isOnline()) return;
    if (state.phase === "preparing") return;
    const { status, row } = await checkReadiness(businessId);
    if (status === "ready") {
      setState({
        phase: "ready",
        stale: false,
        businessId,
        modalOpen: false,
        lastReadyAt: row?.completedAt ?? state.lastReadyAt,
      });
      return;
    }
    if (status === "stale") setState({ stale: true });
    await this.start({ refresh: false });
  },
  continueUsing() {
    const businessId = state.businessId ?? sessionBusinessId();
    if (businessId) writeDismissed(businessId);
    setState({ modalOpen: false, dismissed: true });
  },
  openPanel() {
    setState({ panelOpen: true });
  },
  closePanel() {
    setState({ panelOpen: false });
  },
  closeModal() {
    this.continueUsing();
  },
  /** Test-only reset. */
  __reset() {
    starting = null;
    state = {
      phase: "idle",
      stale: false,
      businessId: null,
      tasks: [],
      completed: 0,
      total: 0,
      modalOpen: false,
      panelOpen: false,
      dismissed: false,
      lastReadyAt: null,
    };
  },
};

export function usePrep() {
  const snap = useSyncExternalStore(
    prepStore.subscribe,
    prepStore.getSnapshot,
    prepStore.getSnapshot,
  );
  const start = useCallback((options?: { refresh?: boolean }) => prepStore.start(options), []);
  const evaluate = useCallback(() => prepStore.evaluate(), []);
  const continueUsing = useCallback(() => prepStore.continueUsing(), []);
  const openPanel = useCallback(() => prepStore.openPanel(), []);
  const closePanel = useCallback(() => prepStore.closePanel(), []);
  const closeModal = useCallback(() => prepStore.closeModal(), []);
  return { ...snap, start, evaluate, continueUsing, openPanel, closePanel, closeModal };
}
