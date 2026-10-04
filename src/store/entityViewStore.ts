"use client";

import { useSyncExternalStore } from "react";
import { parseEntityHref, type EntityHref } from "@/data/pwa/entity-href";

type EntityViewState = {
  stack: EntityHref[];
};

const listeners = new Set<() => void>();
let state: EntityViewState = { stack: [] };

function emit() {
  listeners.forEach((listener) => listener());
}

function setStack(stack: EntityHref[]) {
  state = { stack };
  emit();
}

export const entityViewStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot(): EntityViewState {
    return state;
  },
  /** Opens a ficha inside the already-loaded shell. Returns false if href is not an entity. */
  open(href: string): boolean {
    const parsed = parseEntityHref(href);
    if (!parsed) return false;
    const top = state.stack[state.stack.length - 1];
    if (top?.href === parsed.href) return true;
    setStack([...state.stack, parsed]);
    return true;
  },
  /** Replaces the current ficha. Used when an action finishes and returns to the entity. */
  replace(href: string): boolean {
    const parsed = parseEntityHref(href);
    if (!parsed) return false;
    setStack(state.stack.length > 0 ? [...state.stack.slice(0, -1), parsed] : [parsed]);
    return true;
  },
  back() {
    setStack(state.stack.slice(0, -1));
  },
  close() {
    setStack([]);
  },
  /** Online again: drop the overlay. The page underneath stays. No reload, no assign, no push. */
  dismissOnOnline() {
    if (state.stack.length === 0) return;
    setStack([]);
  },
  __reset() {
    state = { stack: [] };
  },
};

export function useEntityView() {
  return useSyncExternalStore(
    entityViewStore.subscribe,
    entityViewStore.getSnapshot,
    entityViewStore.getSnapshot,
  );
}
