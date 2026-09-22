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

let starting: Promise<void> | null = null;

async function startInternal(businessId: string): Promise<void> {
  const { defs } = await buildPrepTaskDefs(businessId);
  setState({
    phase: "preparing",
    businessId,
    tasks: defs.map((d) => ({ key: d.key, label: d.label, group: d.group, status: "pending" as const, error: null, detail: null })),
    completed: 0,
    total: defs.length,
    modalOpen: true,
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
  });
  if (row.status === "ready") {
    setState({ phase: "ready", lastReadyAt: row.completedAt });
  } else {
    setState({ phase: "failed" });
  }
}

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
  /** Starts preparation unless one is already running for any business. */
  start(): Promise<void> {
    const businessId = sessionBusinessId();
    if (!businessId || !isOnline()) return Promise.resolve();
    if (starting) return starting;
    starting = startInternal(businessId).finally(() => {
      starting = null;
    });
    return starting;
  },
  /** Opens the blocking modal when this device still needs preparation. */
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
    if (status === "stale") {
      setState({ stale: true });
    }
    await this.start();
  },
  closeModal() {
    if (state.phase === "ready") setState({ modalOpen: false });
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
  const start = useCallback(() => prepStore.start(), []);
  const evaluate = useCallback(() => prepStore.evaluate(), []);
  const closeModal = useCallback(() => prepStore.closeModal(), []);
  return { ...snap, start, evaluate, closeModal };
}
