"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

/** navigator.onLine as a hook. SSR and hydration render as online (no #418). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine !== false,
    () => true,
  );
}

const noop = () => () => undefined;

/** false during SSR and the hydration render, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

export const OFFLINE_RECORD_BAND = { text: "Sin conexión · datos guardados en este teléfono." } as const;

/** Hero band for record screens read from IndexedDB: shown whenever the device is offline. */
export function useOfflineBand(): { text: string } | null {
  return useOnline() ? null : OFFLINE_RECORD_BAND;
}
