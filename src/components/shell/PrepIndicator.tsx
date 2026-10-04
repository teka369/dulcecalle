"use client";

import { usePrep } from "@/store/prepStore";

const GROUP_TITLES = {
  app: "Aplicación",
  catalogos: "Catálogos",
  historial: "Histórico",
  resumen: "Resúmenes",
  sistema: "Verificación",
} as const;

function labelFor(phase: string, stale: boolean, completed: number, total: number): string {
  if (phase === "preparing" && stale) return "Actualizando offline";
  if (phase === "preparing") return total > 0 ? `Preparando offline · ${completed} de ${total}` : "Preparando offline";
  if (phase === "ready") return "Offline listo";
  if (phase === "failed") return "Preparación pendiente";
  return "Preparación offline";
}

export function PrepIndicator() {
  const { phase, stale, completed, total, tasks, panelOpen, openPanel, closePanel, start } = usePrep();
  if (phase === "idle") return null;
  const label = labelFor(phase, stale, completed, total);
  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="fixed bottom-20 left-1/2 z-[70] min-h-11 -translate-x-1/2 rounded-full border border-border bg-surface px-4 text-xs font-semibold text-ink shadow-[var(--shadow-md)]"
        aria-live="polite"
      >
        {phase === "failed" ? "!" : phase === "ready" ? "✓" : "↻"} {label}
      </button>
      {panelOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/45 px-3 pb-24">
          <div role="dialog" aria-modal="true" aria-labelledby="prep-panel-title" className="w-full max-w-lg rounded-[var(--r-lg)] border border-border bg-surface p-5">
            <h2 id="prep-panel-title" className="text-base font-semibold">Preparación offline</h2>
            <p className="mt-1 text-sm text-ink-muted">{label}. La app sigue disponible.</p>
            {(["app", "catalogos", "historial", "resumen", "sistema"] as const).map((group) => {
              const groupTasks = tasks.filter((task) => task.group === group);
              if (groupTasks.length === 0) return null;
              return (
                <div key={group} className="mt-3">
                  <h3 className="text-xs font-semibold uppercase text-ink-muted">{GROUP_TITLES[group]}</h3>
                  <ul className="mt-1 flex flex-col gap-1">
                    {groupTasks.map((task) => (
                      <li key={task.key} className="flex justify-between text-sm">
                        <span>{task.label}</span>
                        <span>{task.status === "done" ? "Lista" : task.status === "failed" ? "Error" : task.status === "running" ? "Preparando" : "Pendiente"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <button type="button" onClick={() => void start({ refresh: true })} className="mt-4 min-h-11 w-full rounded-[var(--r-md)] border border-border text-sm font-semibold">
              Actualizar preparación offline
            </button>
            <button type="button" onClick={closePanel} className="mt-2 min-h-11 w-full rounded-[var(--r-md)] bg-cta text-sm font-semibold text-cta-fg">
              Seguir usando la app
            </button>
          </div>
        </div>
      )}
    </>
  );
}
