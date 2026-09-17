"use client";

import { usePathname } from "next/navigation";
import { BottomNav } from "./BottomNav";
import { Fab } from "./Fab";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome =
    pathname.startsWith("/ventas/nueva") ||
    pathname.startsWith("/ventas/cobrar") ||
    pathname === "/clientes/nuevo" ||
    /^\/clientes\/[^/]+\/abono$/.test(pathname) ||
    pathname === "/inventario/nuevo" ||
    pathname === "/inventario/proveedores/nuevo" ||
    /^\/inventario\/[^/]+\/(surtir|me-lo-comi|regalo|perdido)$/.test(pathname);
  // Hide FAB on Cerrar caja so it does not cover Confirmar cierre
  const hideFab =
    pathname.startsWith("/mas/caja/cerrar") || pathname.startsWith("/mas/datos");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col bg-bg text-ink">
      <main className={`flex-1 px-4 ${hideChrome ? "pb-6 pt-4" : "pb-28 pt-4"}`}>
        {children}
      </main>
      {!hideChrome && (
        <>
          {!hideFab && <Fab />}
          <BottomNav />
        </>
      )}
    </div>
  );
}
