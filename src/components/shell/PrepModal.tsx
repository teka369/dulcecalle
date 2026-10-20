"use client";

import { Badge } from "@/components/ui/Badge";
import { GlyphIcon } from "@/components/ui/icons";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { usePrep } from "@/store/prepStore";

const GROUP_TITLES = {
  app: "Aplicación",
  catalogos: "Catálogos",
  historial: "Historial",
  resumen: "Resumen",
  sistema: "Sistema",
} as const;

const TASK_DOT: Record<string, string> = {
  done: "bg-ok",
  running: "bg-warning animate-pulse",
  failed: "bg-danger",
};

function TaskIcon({ status }: { status: string }) {
  return <span aria-hidden className={`inline-block size-2 shrink-0 rounded-full ${TASK_DOT[status] ?? "border border-ink-muted"}`} />;
}

/**
 * First-run explanation. Closing it does not stop preparation.
 * The app stays usable; the indicator keeps the status.
 */
export function PrepModal() {
  const { phase, tasks, completed, total, modalOpen, evaluate, continueUsing, start } = usePrep();

  const pathname = usePathname();
  useEffect(() => {
    void evaluate();
    const onOnline = () => void evaluate();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [evaluate, pathname]);

  useEffect(() => {
    if (phase !== "ready" || !modalOpen) return;
    const timer = window.setTimeout(() => continueUsing(), 1600);
    return () => window.clearTimeout(timer);
  }, [phase, modalOpen, continueUsing]);

  if (!modalOpen) return null;

  const failed = tasks.filter((t) => t.status === "failed");
  const progress = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-ink/45 px-4 py-6 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prep-title"
        className="w-full max-w-sm overflow-hidden rounded-[28px] bg-bg shadow-[var(--shadow-lg)]"
      >
        {phase === "ready" ? (
          <>
            <div className="bg-hero px-5 pb-6 pt-5 text-on-hero">
              <h2 id="prep-title" className="flex items-center gap-2 text-[22px] font-semibold">
                <span aria-hidden className="[&_svg]:size-6"><GlyphIcon name="check" /></span>
                Dulce Calle está listo
              </h2>
            </div>
            <div className="-mt-3 rounded-t-[28px] bg-bg px-5 pb-5 pt-4">
            <p className="text-sm leading-snug text-ink-muted">
              Productos, clientes y proveedores quedaron en este teléfono, junto con las pantallas y el historial de la ventana preparada.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-muted">
              Lo que anotes sin conexión se envía cuando vuelva internet. Esto no es una copia del negocio: el historial sigue en el servidor. Si abres directo una ficha que nunca cargaste, puede pedir conexión. Entra por el inicio y navega desde las secciones preparadas.
            </p>
            </div>
          </>
        ) : (
          <>
            <div className="bg-hero px-5 pb-6 pt-5 text-on-hero">
              <h2 id="prep-title" className="text-[22px] font-semibold">
                Preparando Dulce Calle
              </h2>
              <p className="mt-1 text-sm leading-snug text-on-hero-muted">
                Estamos guardando productos, clientes, proveedores, ventas, fiados, caja y movimientos en este teléfono.
              </p>
            </div>
            <div className="-mt-3 max-h-[70dvh] overflow-y-auto rounded-t-[28px] bg-bg px-5 pb-5 pt-4">
            <div>
              <div className="flex items-center justify-between text-xs font-medium tabular-nums text-ink-muted">
                <span>
                  {completed} de {total} tareas completadas
                </span>
                <span>{progress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-cta transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            {(["app", "catalogos", "historial", "resumen", "sistema"] as const).map((group) => {
              const groupTasks = tasks.filter((t) => t.group === group);
              if (groupTasks.length === 0) return null;
              return (
                <div key={group} className="mt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {GROUP_TITLES[group]}
                  </h3>
                  <ul className="mt-2 divide-y divide-border overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface">
                    {groupTasks.map((task) => (
                      <li
                        key={task.key}
                        className="flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <TaskIcon status={task.status} />
                          <span className="min-w-0 truncate">{task.label}</span>
                        </span>
                        {task.status === "failed" ? (
                          <Badge tone="danger" className="shrink-0">
                            Error
                          </Badge>
                        ) : (
                          task.detail && (
                            <span className="shrink-0 text-xs text-ink-muted">{task.detail}</span>
                          )
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            {phase === "failed" && (
              <div className="mt-4 rounded-[var(--r-lg)] border border-danger/30 bg-danger-soft p-3">
                <p className="text-sm font-semibold">Preparación incompleta</p>
                <p className="mt-1 text-xs leading-relaxed text-ink">
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
                <p className="mt-2 text-xs leading-relaxed text-ink">
                  No estás listo para trabajar sin conexión.
                </p>
                <button
                  type="button"
                  onClick={() => void start()}
                  className="mt-3 min-h-11 w-full rounded-[var(--r-md)] bg-cta text-sm font-semibold text-cta-fg"
                >
                  Reintentar
                </button>
              </div>
            )}

            <p className="mt-4 text-xs text-ink-muted">Puedes seguir usando Dulce Calle. Lo que falte se indica en cada pantalla.</p>
            <button
              type="button"
              onClick={continueUsing}
              className="mt-3 min-h-12 w-full rounded-[var(--r-md)] bg-cta text-base font-semibold text-cta-fg"
            >
              Continuar usando la app
            </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
