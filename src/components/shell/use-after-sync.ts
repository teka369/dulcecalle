"use client";

import { useEffect, useRef } from "react";
import { SYNC_COMPLETE_EVENT } from "@/data/pwa/sync-coordinator";

/**
 * Re-run a screen's DATA load after the reconnect outbox sync completes.
 * Never reloads or navigates the page (reloadOnOnline is off on purpose).
 */
export function useAfterSync(load: () => unknown): void {
  const ref = useRef(load);
  useEffect(() => {
    ref.current = load;
  });
  useEffect(() => {
    const on = () => {
      try {
        void Promise.resolve(ref.current()).catch(() => undefined);
      } catch {
        /* a failed refresh keeps the current data on screen */
      }
    };
    window.addEventListener(SYNC_COMPLETE_EVENT, on);
    return () => window.removeEventListener(SYNC_COMPLETE_EVENT, on);
  }, []);
}
