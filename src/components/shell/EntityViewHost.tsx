"use client";

import { useEffect, useRef } from "react";
import { BOOT_ENTITY_ATTR, bootRestoreTarget } from "@/data/pwa/boot-restore";
import { coldLoadParentPath, parseEntityHref } from "@/data/pwa/entity-href";
import { isOffline } from "@/data/pwa/offline-nav";
import { EntityIdProvider } from "@/components/shell/entity-route";
import { entityViewStore, useEntityView } from "@/store/entityViewStore";
import type { EntityHref } from "@/data/pwa/entity-href";
import ProductoFichaPage from "@/app/inventario/[id]/page";
import SurtirPage from "@/app/inventario/[id]/surtir/page";
import PrepararPage from "@/app/inventario/[id]/preparar/page";
import MeLoComiPage from "@/app/inventario/[id]/me-lo-comi/page";
import RegaloPage from "@/app/inventario/[id]/regalo/page";
import PerdidoPage from "@/app/inventario/[id]/perdido/page";
import ClienteFichaPage from "@/app/clientes/[id]/page";
import AbonoPage from "@/app/clientes/[id]/abono/page";
import DeudaInicialPage from "@/app/clientes/[id]/deuda-inicial/page";
import ProveedorFichaPage from "@/app/inventario/proveedores/[id]/page";
import VentaDetallePage from "@/app/ventas/[id]/page";
import DevolverPage from "@/app/ventas/[id]/devolver/page";

function EntityScreen({ view }: { view: EntityHref }) {
  if (view.kind === "product" && view.action === "surtir") return <SurtirPage />;
  if (view.kind === "product" && view.action === "preparar") return <PrepararPage />;
  if (view.kind === "product" && view.action === "me-lo-comi") return <MeLoComiPage />;
  if (view.kind === "product" && view.action === "regalo") return <RegaloPage />;
  if (view.kind === "product" && view.action === "perdido") return <PerdidoPage />;
  if (view.kind === "product") return <ProductoFichaPage />;
  if (view.kind === "customer" && view.action === "abono") return <AbonoPage />;
  if (view.kind === "customer" && view.action === "deuda-inicial") return <DeudaInicialPage />;
  if (view.kind === "customer") return <ClienteFichaPage />;
  if (view.kind === "supplier") return <ProveedorFichaPage />;
  if (view.kind === "sale" && view.action === "devolver") return <DevolverPage />;
  return <VentaDetallePage />;
}

/** Puts the requested URL back after Next's router canonicalizes to the served list document. */
function keepUrl(path: string) {
  const restore = () => {
    // Follow the overlay if the user already moved on (replace/close).
    const top = entityViewStore.getSnapshot().stack.at(-1)?.href;
    if (top !== undefined ? top !== path : parseEntityHref(path) != null) return;
    if (window.location.pathname !== path) {
      window.history.replaceState(window.history.state, "", path + window.location.search);
    }
  };
  restore();
  window.setTimeout(restore, 0);
  window.requestAnimationFrame(restore);
}

/**
 * In-shell ficha. Opens after an offline click inside an already loaded
 * app, or on boot when a cold offline load of an entity URL was served its
 * parent list document (window.__DC_BOOT_PATH): the ficha opens from
 * IndexedDB and the entity URL stays in the address bar.
 */
export function EntityViewHost() {
  const { stack } = useEntityView();
  const view = stack[stack.length - 1];
  /** URL of what is underneath the overlay (the list for a cold-load restore). */
  const baseUrl = useRef<string | null>(null);

  useEffect(() => {
    const target = bootRestoreTarget(window.__DC_BOOT_PATH, isOffline());
    window.__DC_BOOT_PATH = undefined;
    if (target) {
      if (target.kind === "entity") {
        baseUrl.current = coldLoadParentPath(target.path);
        entityViewStore.open(target.path);
      }
      keepUrl(target.path);
    }
    document.documentElement.removeAttribute(BOOT_ENTITY_ATTR);
  }, []);

  // The address bar always matches what is shown: the top ficha while the
  // overlay is open, the page underneath once it closes.
  const topHref = view?.href ?? null;
  useEffect(() => {
    if (topHref) {
      if (baseUrl.current == null) baseUrl.current = window.location.pathname;
      if (window.location.pathname !== topHref) {
        window.history.replaceState(window.history.state, "", topHref);
      }
      return;
    }
    if (baseUrl.current != null) {
      const base = baseUrl.current;
      baseUrl.current = null;
      if (window.location.pathname !== base) window.history.replaceState(window.history.state, "", base);
    }
  }, [topHref]);

  useEffect(() => {
    const onOnline = () => entityViewStore.dismissOnOnline();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  if (!view) return null;

  return (
    <div className="fixed inset-0 z-[75] overflow-y-auto bg-bg" data-testid="entity-view">
      <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 pb-28 pt-4">
        <button
          type="button"
          onClick={() => entityViewStore.back()}
          className="mb-3 min-h-11 w-fit rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm font-medium"
        >
          ← Volver
        </button>
        <EntityIdProvider id={view.id}>
          <EntityScreen view={view} />
        </EntityIdProvider>
      </div>
    </div>
  );
}
