"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { usePrep } from "@/store/prepStore";

const GROUP_TITLES = {
  app: "Aplicación",
  catalogos: "Catálogos",
} as const;

function TaskIcon({ status }: { status: string }) {
  if (status === "done") return <span aria-hidden>✓</span>;
  if (status === "running") return <span aria-hidden>↻</span>;
  if (status === "failed") return <span aria-hidden>!</span>;
  return <span aria-hidden>○</span>;
}

/**
 * Blocking offline-preparation modal. Unlike SyncCenter, this intentionally
 * locks the app until the device is ready: an incomplete preparation would
 * silently fail offline later. No close/cancel by design.
 */
export function PrepModal() {
  const { phase, tasks, completed, total, modalOpen, evaluate, start, closeModal } = usePrep();

  const pathname = usePathname();
  useEffect(() => {
    void evaluate();
    const onOnline = () => void evaluate();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [evaluate, pathname]);

  useEffect(() => {
    if (phase !== "ready" || !modalOpen) return;
    const timer = window.setTimeout(() => closeModal(), 1600);
    return () => window.clearTimeout(timer);
  }, [phase, modalOpen, closeModal]);

  if (!modalOpen) return null;

  const failed = tasks.filter((t) => t.status === "failed");
  const progress = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-ink/45 px-5 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prep-title"
        className="w-full max-w-sm rounded-[28px] border border-ink/10 bg-surface p-5 shadow-2xl"
      >
        {phase === "ready" ? (
          <>
            <h2 id="prep-title" className="text-base font-semibold">
              ✓ Dulce Calle está listo
            </h2>
            <p className="mt-1 text-sm leading-snug text-ink/60">
              Tu dispositivo ya está preparado para trabajar sin conexión.
            </p>
            <p className="mt-2 text-xs text-ink/55">
              Datos preparados: catálogos y documentos de la app.
            </p>
          </>
        ) : (
          <>
            <h2 id="prep-title" className="text-base font-semibold">
              Preparando Dulce Calle
            </h2>
            <p className="mt-1 text-sm leading-snug text-ink/60">
              Estamos guardando en este dispositivo todo lo necesario para
              seguir trabajando si pierdes internet.
            </p>

            <div className="mt-4">
              <div className="flex items-center justify-between text-xs font-medium text-ink/55">
                <span>
                  {completed} de {total} tareas completadas
                </span>
                <span>{progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
                <div
                  className="h-full rounded-full bg-cta transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {(["app", "catalogos"] as const).map((group) => {
              const groupTasks = tasks.filter((t) => t.group === group);
              if (groupTasks.length === 0) return null;
              return (
                <div key={group} className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                    {GROUP_TITLES[group]}
                  </h3>
                  <ul className="mt-2 flex flex-col gap-1">
                    {groupTasks.map((task) => (
                      <li
                        key={task.key}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          <TaskIcon status={task.status} /> {task.label}
                        </span>
                        {task.status === "failed" && (
                          <span className="shrink-0 text-xs font-semibold text-danger">
                            Error
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            {phase === "failed" && (
              <div className="mt-4 rounded-2xl border border-danger/20 bg-danger/5 p-3">
                <p className="text-sm font-semibold">Preparación incompleta</p>
                <p className="mt-1 text-xs leading-relaxed text-ink/70">
                  {completed} de {total} tareas completadas. Faltan datos
                  necesarios:
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {failed.map((task) => (
                    <li key={task.key} className="text-xs text-danger">
                      {task.label}
                      {task.error ? `: ${task.error}` : ""}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs leading-relaxed text-ink/70">
                  No estás listo para trabajar sin conexión.
                </p>
                <button
                  type="button"
                  onClick={() => void start()}
                  className="mt-3 min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white"
                >
                  Reintentar
                </button>
              </div>
            )}

            {phase !== "failed" && (
              <p className="mt-4 text-xs text-ink/55">No cierres la aplicación.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
