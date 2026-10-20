import { userFacingMessage } from "@/domain/ux/user-message";
import type { ReactNode } from "react";

export type StateBlockProps = {
  kind: "empty" | "error" | "offline-miss";
  title: string;
  body?: string;
  action?: ReactNode;
  /** Render on hero (error inside hero) instead of a sheet group. */
  onHero?: boolean;
};

export function StateBlock({ kind, title, body: rawBody, action, onHero = false }: StateBlockProps) {
  // Error bodies come from caught exceptions: never show technical text.
  const filtered = kind === "error" && rawBody ? userFacingMessage(rawBody, "Inténtalo de nuevo con Reintentar.") : rawBody;
  // Never say the same thing twice (e.g. title «No se pudo cargar.» + the same fallback body).
  const same = (a: string, b: string) => a.trim().replace(/[.\s]+$/, "").toLowerCase() === b.trim().replace(/[.\s]+$/, "").toLowerCase();
  const body = filtered && same(filtered, title) ? undefined : filtered;
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={
        onHero
          ? "flex flex-col gap-2 py-4"
          : "flex flex-col gap-2 rounded-[var(--r-lg)] border border-border bg-surface px-3 py-4"
      }
    >
      <p className={`text-base font-semibold ${onHero ? "" : "text-ink"}`}>{title}</p>
      {body ? <p className={`text-sm ${onHero ? "text-on-hero-muted" : "text-ink-muted"}`}>{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
