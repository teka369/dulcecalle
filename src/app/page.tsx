"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  InicioDashboard,
  InicioSkeleton,
} from "@/components/dashboard/InicioDashboard";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import { loadDashboard } from "@/repositories";
import { loadDemoData } from "@/storage/seed";

export default function InicioPage() {
  const pathname = usePathname();
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSnap(await loadDashboard());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  async function onLoadDemo() {
    await loadDemoData();
    setToast("Demo cargada");
    await refresh();
    setTimeout(() => setToast(null), 2000);
  }

  if (!snap) {
    return <InicioSkeleton />;
  }

  return (
    <InicioDashboard snap={snap} onLoadDemo={() => void onLoadDemo()} toast={toast} />
  );
}
