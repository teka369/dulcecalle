"use client";

import { useEffect } from "react";
import { startOutboxSync } from "@/data/pwa/sync-coordinator";

export function SalesSyncBridge() {
  useEffect(() => {
    const stop = startOutboxSync();
    return () => {
      stop();
    };
  }, []);
  return null;
}
