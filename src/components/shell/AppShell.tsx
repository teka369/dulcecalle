"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { Fab } from "./Fab";
import { AuthGate } from "./AuthGate";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/cliente" ||
    pathname.startsWith("/cliente/") ||
    pathname.startsWith("/ventas/nueva") ||
    pathname.startsWith("/ventas/cobrar") ||
    /^\/ventas\/[^/]+\/devolver$/.test(pathname) ||
    pathname === "/clientes/nuevo" ||
    /^\/clientes\/[^/]+\/abono$/.test(pathname) ||
    /^\/clientes\/[^/]+\/deuda-inicial$/.test(pathname) ||
    pathname === "/inventario/nuevo" ||
    pathname === "/inventario/proveedores/nuevo" ||
    /^\/inventario\/[^/]+\/(surtir|me-lo-comi|regalo|perdido)$/.test(pathname) ||
    pathname.startsWith("/mas/gastos/nuevo") ||
    pathname.startsWith("/mas/caja/aporte") ||
    pathname.startsWith("/mas/caja/retiro") ||
    pathname.startsWith("/mas/caja/cerrar");
  const hideFab = pathname.startsWith("/mas/datos");

  // Chrome clearance: BottomNav + FAB/SyncPill band (~4.5rem above nav) + safe-area
  // so primary actions / last list rows are not covered by Sync chrome or FAB.
  const mainPad = hideChrome
    ? "pb-6 pt-4"
    : "pb-[calc(7.5rem+env(safe-area-inset-bottom))] pt-4";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col overflow-x-hidden bg-bg text-ink">
      <AuthGate>
      <main className={`flex-1 px-4 ${mainPad}`}>
        {children}
      </main>
      {!hideChrome && (
        <>
          {!hideFab && <Fab />}
          <BottomNav />
        </>
      )}
      </AuthGate>
    </div>
  );
}
