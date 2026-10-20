"use client";

import { usePrep } from "@/store/prepStore";
import { Badge } from "@/components/ui/Badge";
import { SectionHead } from "@/components/ui/SectionHead";

const TASK_TONE = { done: "ok", failed: "danger", running: "warning" } as const;
const TASK_WORD = { done: "Lista", failed: "Error", running: "Preparando" } as const;
const TAB_TONE: Record<string, string> = {
  failed: "border-danger/40 text-danger",
  ready: "border-ok/40 text-ok",
};

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
  // On Inicio the vertically-centred tab sat over the hero; seat it low on
  // the right edge of the sheet instead (above SyncPill/nav).
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
          className={`prep-tab fixed z-50 flex min-h-11 max-w-[6rem] items-center gap-1 rounded-[var(--r-pill)] border bg-surface px-3 text-xs font-semibold shadow-[var(--shadow-md)] bottom-[calc(5.5rem+env(safe-area-inset-bottom))] ${TAB_TONE[phase] ?? "border-border text-ink"}`}
          style={{ right: "max(calc(0.75rem + env(safe-area-inset-right)), calc((100vw - 32rem) / 2 + 0.75rem))" }}
        >
          {/* Same row as the SyncPill (right slot it leaves free), inside the
              reserved bottom padding — never a mid-sheet tab over the rows. */}
          <span aria-hidden className="truncate">
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
            className="absolute inset-y-0 right-0 flex w-[min(22rem,calc(100vw-2.75rem))] max-w-sm flex-col overflow-hidden rounded-l-[28px] bg-bg shadow-[var(--shadow-lg)]"
            style={{ paddingRight: "env(safe-area-inset-right)" }}
          >
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 pt-[max(1rem,env(safe-area-inset-top))]">
              <h2 id="prep-panel-title" className="text-[22px] font-semibold text-ink">Preparación offline</h2>
              <p className="mt-1 text-sm text-ink-muted">{label}. La app sigue disponible.</p>
              {(["app", "catalogos", "historial", "resumen", "sistema"] as const).map((group) => {
                const groupTasks = tasks.filter((task) => task.group === group);
                if (groupTasks.length === 0) return null;
                return (
                  <div key={group} className="mt-4 flex flex-col gap-2">
                    <SectionHead title={GROUP_TITLES[group]} />
                    <ul className="divide-y divide-border overflow-hidden rounded-[var(--r-lg)] border border-border bg-surface">
                      {groupTasks.map((task) => (
                        <li key={task.key} className="flex min-h-11 items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate text-ink">{task.label}</span>
                          <Badge tone={TASK_TONE[task.status as keyof typeof TASK_TONE] ?? "neutral"} className="shrink-0">
                            {TASK_WORD[task.status as keyof typeof TASK_WORD] ?? "Pendiente"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <button type="button" onClick={() => void start({ refresh: true })} className="mt-5 min-h-11 w-full rounded-[var(--r-md)] border border-border bg-surface text-sm font-semibold text-ink">
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
