/** Routes that own the bottom of the screen (forms, auth, portal). */
export function shellHidesChrome(pathname: string): boolean {
  return (
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
    pathname.startsWith("/mas/caja/cerrar")
  );
}

export function shellHidesFab(pathname: string): boolean {
  return pathname.startsWith("/mas/datos");
}
