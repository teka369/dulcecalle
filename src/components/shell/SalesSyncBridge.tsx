"use client";

import { useEffect } from "react";
import { startOutboxSync } from "@/data/pwa/sync-coordinator";
import { installNavDebug } from "@/data/pwa/nav-debug";

export function SalesSyncBridge() {
  useEffect(() => {
    installNavDebug();
    const stop = startOutboxSync();
    return () => {
      stop();
    };
  }, []);
  return null;
}
