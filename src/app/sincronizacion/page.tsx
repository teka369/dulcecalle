"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getPwaAuthSession } from "@/data/http/session";
import { syncAllPending } from "@/data/pwa/sync-coordinator";
import {
  describeOutboxOperation,
  describeTrayStatus,
  discardOutboxOperation,
  listTrayForSession,
  retryOutboxOperation,
  type TrayItem,
} from "@/data/pwa/sync-tray";

export default function SincronizacionPage() {
  const [items, setItems] = useState<TrayItem[]>([]);
  const [ready, setReady] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listTrayForSession());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar.");
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function retry(item: TrayItem) {
    const businessId = getPwaAuthSession().businessId;
    if (!businessId || busyId) return;
    setBusyId(item.operationId);
    setError(null);
    try {
      await retryOutboxOperation(businessId, item.operationId);
      setToast("Se reintentará la sincronización.");
      // Flush now so the retry runs without waiting for another event.
      await syncAllPending(businessId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reintentar.");
    } finally {
      setBusyId(null);
    }
  }

  async function discard(item: TrayItem) {
    const businessId = getPwaAuthSession().businessId;
    if (!businessId || busyId) return;
    setBusyId(item.operationId);
    setError(null);
    try {
      await discardOutboxOperation(businessId, item.operationId);
      setToast("Operación descartada de este dispositivo.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descartar.");
    } finally {
      setBusyId(null);
    }
  }

  if (!ready) {
    return <p className="text-sm text-ink/60">Cargando…</p>;
  }

  return (
    <div className="flex flex-col gap-4 pb-28">
      <header className="flex items-center gap-2">
        <Link
          href="/"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-[14px] border border-ink/10 bg-surface text-lg"
          aria-label="Volver"
        >
          ←
        </Link>
        <h1 className="text-[22px] font-semibold">Sincronización</h1>
      </header>

      {items.length === 0 ? (
        <section className="rounded-2xl border border-ink/[0.08] bg-surface p-4">
          <p className="text-sm font-semibold">Todo al día</p>
          <p className="mt-1 text-sm text-ink/60">
            No hay operaciones pendientes ni errores de sincronización.
          </p>
        </section>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li
              key={item.operationId}
              className="rounded-2xl border border-ink/[0.08] bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {describeOutboxOperation(item.entity, item.operation)}
                  </p>
                  <p className="mt-1 text-xs text-ink/60">
                    {new Date(item.localCreatedAt).toLocaleString()} ·{" "}
                    {describeTrayStatus(item.status)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
                    item.status === "failed"
                      ? "bg-danger/10 text-danger"
                      : "bg-primary/20 text-ink"
                  }`}
                >
                  {item.status === "failed" ? "Error" : describeTrayStatus(item.status)}
                </span>
              </div>

              {item.status === "failed" && item.lastError && (
                <p className="mt-2 text-sm text-danger">{item.lastError}</p>
              )}

              {item.status === "failed" && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busyId === item.operationId}
                    onClick={() => void retry(item)}
                    className="min-h-11 rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Reintentar
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.operationId}
                    onClick={() => void discard(item)}
                    className="min-h-11 rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold text-ink/70 disabled:opacity-40"
                  >
                    Descartar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <p className="text-xs leading-relaxed text-ink/60">
          Descartar elimina el pendiente de este dispositivo. No deshace nada
          que ya esté guardado en el servidor.
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {toast && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white">
          {toast}
        </div>
      )}
    </div>
  );
}
