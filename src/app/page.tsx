"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  InicioDashboard,
  InicioSkeleton,
} from "@/components/dashboard/InicioDashboard";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import { loadHttpDashboard } from "@/data/pwa/dashboard";

export default function InicioPage() {
  const pathname = usePathname();
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSnap(await loadHttpDashboard());
  }, []);

  useEffect(() => {
    void refresh().catch((e: unknown) => {
      setToast(e instanceof Error ? e.message : "No se pudo cargar el inicio");
    });
  }, [refresh, pathname]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  if (!snap) {
    return <InicioSkeleton />;
  }

  return <InicioDashboard snap={snap} toast={toast} />;
}
