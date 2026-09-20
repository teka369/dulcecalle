"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type SyncState = {
  open: boolean;
  total: number;
  completed: number;
  current: string;
  failed: number;
  error: string | null;
};

type SyncEventDetail = {
  type: "start" | "item" | "done";
  total?: number;
  completed?: number;
  entity?: string;
  operation?: string;
  status?: "synced" | "failed";
  message?: string;
  result?: {
    synced: number;
    failed: number;
    blocked: number;
    stopped: boolean;
  };
};

const OPERATION_LABELS: Record<string, string> = {
  "cashSession:open": "abriendo la caja",
  "cashSession:close": "cerrando la caja",
  "cashMove:create": "registrando un movimiento de caja",
  "expense:create": "guardando un gasto",
  "stockMove:surtir": "actualizando el inventario",
  "stockMove:shrink": "actualizando una salida de inventario",
  "sale:create": "guardando una venta",
  "customerPayment:pay": "registrando un abono",
  "customer:create": "guardando un cliente",
  "supplier:create": "guardando un proveedor",
};

function operationLabel(entity?: string, operation?: string): string {
  return (
    (entity && operation && OPERATION_LABELS[`${entity}:${operation}`]) ??
    "guardando información"
  );
}

function friendlyError(value: unknown): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value;
  return "Ocurrió un error inesperado. Revisa la conexión e inténtalo de nuevo.";
}

const CLOSED_SYNC_STATE: SyncState = {
  open: false,
  total: 0,
  completed: 0,
  current: "",
  failed: 0,
  error: null,
};

export function SyncStatusOverlay() {
  const router = useRouter();
  const [sync, setSync] = useState<SyncState>(CLOSED_SYNC_STATE);
  const [online, setOnline] = useState(true);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<SyncEventDetail>).detail;
      if (!detail) return;

      if (detail.type === "start") {
        setSync({
          open: true,
          total: detail.total ?? 0,
          completed: 0,
          current: "Preparando datos…",
          failed: 0,
          error: null,
        });
        return;
      }

      if (detail.type === "item") {
        const failed = detail.status === "failed";
        setSync((previous) => ({
          ...previous,
          open: true,
          total: detail.total ?? previous.total,
          completed: detail.completed ?? previous.completed,
          current: failed
            ? "Hubo un problema con un dato"
            : operationLabel(detail.entity, detail.operation),
          failed: previous.failed + (failed ? 1 : 0),
          error: failed
            ? detail.message ?? "No se pudo enviar este dato."
            : previous.error,
        }));
        if (failed) {
          setErrorToast(detail.message ?? "No se pudo sincronizar un dato.");
        }
        return;
      }

      if (detail.type === "done") {
        const result = detail.result;
        const failed = result?.failed ?? 0;
        setSync((previous) => ({
          ...previous,
          open: true,
          completed: result?.synced ?? previous.completed,
          current:
            failed > 0
              ? "La sincronización terminó con algunos problemas"
              : "¡Todo quedó guardado en la base de datos!",
          failed,
          error:
            failed > 0
              ? previous.error ?? "Hay datos pendientes por enviar."
              : null,
        }));

        window.setTimeout(() => {
          setSync((previous) => ({
            ...previous,
            open: false,
          }));
        }, failed > 0 ? 2200 : 1200);
      }
    };

    const onWindowError = (event: ErrorEvent) => {
      const message = friendlyError(event.error ?? event.message);
      setErrorToast(message);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      setErrorToast(friendlyError(event.reason));
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("dulcecalle:sync", onSync);
    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("dulcecalle:sync", onSync);
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (!errorToast) return;
    const timer = window.setTimeout(() => setErrorToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [errorToast]);

  const progress = useMemo(() => {
    if (!sync.open || sync.total <= 0) return 0;
    return Math.min(100, Math.round((sync.completed / sync.total) * 100));
  }, [sync]);

  return (
    <>
      {!online && (
        <div className="fixed inset-x-0 top-0 z-[80] flex justify-center px-3 pt-2">
          <div className="rounded-full border border-danger/20 bg-surface px-3 py-2 text-xs font-semibold text-danger shadow-lg">
            Sin conexión · los cambios nuevos se guardarán en este dispositivo
          </div>
        </div>
      )}

      {sync.open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/45 px-5 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="sync-title"
            className="w-full max-w-sm overflow-hidden rounded-[28px] border border-ink/10 bg-surface p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl">
                {sync.failed > 0 ? "!" : "↻"}
              </div>
              <div className="min-w-0">
                <h2 id="sync-title" className="text-base font-semibold">
                  {sync.failed > 0 ? "Revisemos la sincronización" : "Guardando tus datos"}
                </h2>
                <p className="mt-1 text-sm leading-snug text-ink/60">
                  {sync.current}
                </p>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs font-medium text-ink/55">
                <span>{sync.completed} de {sync.total}</span>
                <span>{progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full bg-cta transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {sync.failed > 0 ? (
              <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
                {sync.error ?? "Algunos datos no pudieron enviarse todavía."}
                <button
                  type="button"
                  onClick={() => router.push("/sincronizacion")}
                  className="mt-2 min-h-11 w-full rounded-[14px] bg-surface text-sm font-semibold text-ink"
                >
                  Revisar pendientes
                </button>
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-ink/10 bg-bg p-3 text-xs leading-relaxed text-ink/60">
                No cierres la aplicación mientras terminamos. Estamos enviando
                los cambios que hiciste sin conexión al servidor.
              </div>
            )}
          </div>
        </div>
      )}

      {errorToast && !sync.open && (
        <div className="fixed inset-x-0 bottom-24 z-[85] flex justify-center px-4">
          <div
            role="alert"
            className="w-full max-w-md rounded-2xl border border-danger/20 bg-surface px-4 py-3 shadow-xl"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-danger">
              Algo salió mal
            </p>
            <p className="mt-1 text-sm text-ink/80">{errorToast}</p>
          </div>
        </div>
      )}
    </>
  );
}
