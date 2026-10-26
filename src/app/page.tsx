"use client";

import { errorText } from "@/domain/ux/user-message";
import { useCallback, useEffect, useState } from "react";
import { useAfterSync } from "@/components/shell/use-after-sync";
import { usePathname } from "next/navigation";
import {
  InicioDashboard,
  InicioHero,
  InicioSkeleton,
} from "@/components/dashboard/InicioDashboard";
import type { DashboardSnapshot } from "@/domain/dashboard/snapshot";
import { loadDashboardForScreen } from "@/data/pwa/offline-snapshots";
import { useSync } from "@/store/syncStore";

export default function InicioPage() {
  const pathname = usePathname();
  const { online } = useSync();
  const [snap, setSnap] = useState<DashboardSnapshot | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await loadDashboardForScreen();
      setFailed(false);
      setToast(null);
      setSnap(result.data);
      setCapturedAt(result.capturedAt);
      setFromCache(result.source === "cache");
    } catch (e: unknown) {
      setFailed(true);
      setToast(errorText(e, "No se pudo cargar el inicio"));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useAfterSync(refresh);

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
        <InicioHero>
          <div className="flex flex-col gap-3 py-4">
            <h1 className="text-xl font-semibold">No se pudo cargar el inicio</h1>
            <p className="text-sm text-on-hero-muted">
              El inicio estará disponible cuando haya conexión.
            </p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex min-h-11 w-fit items-center rounded-[var(--r-pill)] bg-on-hero px-4 text-sm font-semibold text-hero"
            >
              Reintentar
            </button>
          </div>
        </InicioHero>
      );
    }
    return <InicioSkeleton />;
  }

  return (
    <InicioDashboard
      snap={snap}
      toast={toast}
      fromCache={fromCache}
      capturedAt={capturedAt}
      online={online}
    />
  );
}
