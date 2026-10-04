"use client";

import { usePrep } from "@/store/prepStore";

const GROUP_TITLES = {
  app: "Aplicación",
  catalogos: "Catálogos",
  historial: "Histórico",
  resumen: "Resúmenes",
  sistema: "Verificación",
} as const;

function labelFor(phase: string, stale: boolean): string {
  if (phase === "preparing" && stale) return "Actualizando offline";
  if (phase === "preparing") return "Preparando offline";
  if (phase === "ready") return "Offline listo";
  if (phase === "failed") return "Preparación pendiente";
  return "Preparación offline";
}

function shortFor(phase: string, stale: boolean): string {
  if (phase === "preparing" && stale) return "Actualizando";
  if (phase === "preparing") return "Preparando";
  if (phase === "ready") return "Listo";
  if (phase === "failed") return "Pendiente";
  return "Offline";
}

export function PrepIndicator() {
  const { phase, stale, tasks, panelOpen, openPanel, closePanel, start } = usePrep();
  if (phase === "idle") return null;
  const label = labelFor(phase, stale);
  const mark = phase === "failed" ? "!" : phase === "ready" ? "✓" : "↻";
  return (
    <>
      {!panelOpen && (
        <button
          type="button"
          onClick={openPanel}
          aria-label={label}
          aria-expanded={false}
          aria-controls="prep-panel"
          className="fixed top-1/2 z-[65] flex min-h-11 -translate-y-1/2 items-center rounded-l-[var(--r-md)] border border-r-0 border-border bg-surface py-2 pl-1.5 pr-1 text-[10px] font-semibold text-ink shadow-[var(--shadow-md)]"
          style={{ right: "env(safe-area-inset-right)" }}
        >
          <span aria-hidden className="[writing-mode:vertical-rl] rotate-180">
            {mark} {shortFor(phase, stale)}
          </span>
        </button>
      )}
      {panelOpen && (
        <div className="fixed inset-0 z-[72] overflow-hidden">
          <button
            type="button"
            aria-label="Cerrar preparación offline"
            className="absolute inset-0 bg-ink/40"
            onClick={closePanel}
          />
          <div
            id="prep-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prep-panel-title"
            className="absolute inset-y-0 right-0 flex w-[min(22rem,calc(100vw-2.75rem))] max-w-sm flex-col overflow-hidden border-l border-border bg-surface shadow-[var(--shadow-lg)]"
            style={{ paddingRight: "env(safe-area-inset-right)" }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))]">
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
                        <li key={task.key} className="flex justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate">{task.label}</span>
                          <span className="shrink-0">{task.status === "done" ? "Lista" : task.status === "failed" ? "Error" : task.status === "running" ? "Preparando" : "Pendiente"}</span>
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
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
