"use client";

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

/**
 * In-shell ficha. Only mounted after an offline click inside an already
 * loaded app. A cold navigation never reaches this component; the service
 * worker serves /offline instead of inventing the page.
 */
export function EntityViewHost() {
  const { stack } = useEntityView();
  const view = stack[stack.length - 1];
  if (!view) return null;

  return (
    <div className="fixed inset-0 z-[75] overflow-y-auto bg-bg">
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
