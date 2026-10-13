/**
 * Gestionar cajas reads only from the server (listSessions/unassigned).
 * Offline it shows its own state instead of the generic /offline page.
 */
import { NetworkError } from "@/data/errors";

export const GESTIONAR_OFFLINE_TEXT = "Necesitas internet para gestionar cajas";

export function gestionarIsOffline(offline: boolean, error: unknown): boolean {
  return offline || error instanceof NetworkError;
}

export function GestionarOfflineState() {
  return (
    <div role="status" className="flex flex-col gap-4 py-2" data-testid="gestionar-offline">
      <p className="text-base font-semibold text-ink">{GESTIONAR_OFFLINE_TEXT}</p>
      {/* Full document navigation: offline the service worker serves the prepared Caja. */}
      <a
        href="/mas/caja"
        className="inline-flex h-11 min-h-11 w-full items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg hover:opacity-[0.92]"
      >
        Volver a Caja
      </a>
    </div>
  );
}
