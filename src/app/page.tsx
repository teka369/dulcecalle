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
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    setFailed(false);
    setSnap(await loadHttpDashboard());
  }, []);

  useEffect(() => {
    void refresh().catch((e: unknown) => {
      setFailed(true);
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
    if (failed) {
      return (
        <div className="flex flex-col gap-3 py-8">
          <p className="text-base font-medium">
            No se pudo consultar el servidor.
          </p>
          <p className="text-sm text-ink/60">
            El inicio estará disponible cuando haya conexión.
          </p>
          <button
            type="button"
            onClick={() => void refresh().catch(() => setFailed(true))}
            className="inline-flex min-h-11 w-fit items-center rounded-xl bg-cta px-4 text-sm font-semibold text-white"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return <InicioSkeleton />;
  }

  return <InicioDashboard snap={snap} toast={toast} />;
}
