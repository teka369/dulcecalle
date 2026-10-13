/**
 * Entity fichas are client views. Offline, an already-loaded app opens
 * them from IndexedDB instead of requesting a per-entity document.
 * A cold offline load is served the parent list document (see
 * entityParentPath / coldLoadParentPath) and the shell restores the ficha.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export type EntityKind = "product" | "customer" | "supplier" | "sale";

export type EntityAction =
  | "surtir"
  | "preparar"
  | "me-lo-comi"
  | "regalo"
  | "perdido"
  | "abono"
  | "deuda-inicial"
  | "devolver";

export type EntityHref = {
  href: string;
  id: string;
  kind: EntityKind;
  action: EntityAction | null;
};

const PRODUCT_ACTIONS = ["surtir", "preparar", "me-lo-comi", "regalo", "perdido"] as const;

export function parseEntityHref(href: string): EntityHref | null {
  const path = href.split("?")[0]?.split("#")[0] ?? href;
  const product = path.match(new RegExp(`^/inventario/(${UUID})(?:/(${PRODUCT_ACTIONS.join("|")}))?$`, "i"));
  if (product) {
    return {
      href: path,
      id: product[1],
      kind: "product",
      action: (product[2] as EntityAction | undefined) ?? null,
    };
  }
  const customer = path.match(new RegExp(`^/clientes/(${UUID})(?:/(abono|deuda-inicial))?$`, "i"));
  if (customer) {
    return {
      href: path,
      id: customer[1],
      kind: "customer",
      action: (customer[2] as EntityAction | undefined) ?? null,
    };
  }
  const supplier = path.match(new RegExp(`^/inventario/proveedores/(${UUID})$`, "i"));
  if (supplier) {
    return { href: path, id: supplier[1], kind: "supplier", action: null };
  }
  const sale = path.match(new RegExp(`^/ventas/(${UUID})(?:/(devolver))?$`, "i"));
  if (sale) {
    return {
      href: path,
      id: sale[1],
      kind: "sale",
      action: (sale[2] as EntityAction | undefined) ?? null,
    };
  }
  return null;
}

/** List screen that owns each entity URL (the document PREP stores). */
export function entityParentPath(href: string): string | null {
  const parsed = parseEntityHref(href);
  if (!parsed) return null;
  if (parsed.kind === "product" || parsed.kind === "supplier") return "/inventario";
  if (parsed.kind === "customer") return "/clientes";
  return "/ventas";
}

/** Server-only screens: the shell document is served but the page shows its own offline state. */
const SERVER_ONLY_DETAIL = new RegExp(`^/mas/caja/gestionar/(${UUID})$`, "i");

export function isGestionarCajaDetail(href: string): boolean {
  const path = href.split("?")[0]?.split("#")[0] ?? href;
  return SERVER_ONLY_DETAIL.test(path);
}

/**
 * Online-only exceptions: entity URLs that a cold offline load does NOT
 * restore (they still get /offline). /clientes/[id]/deuda-inicial records
 * an opening balance and stays online-only on a cold load; in an already
 * loaded shell it still opens from IndexedDB.
 */
export const COLD_LOAD_ONLINE_ONLY: readonly EntityAction[] = ["deuda-inicial"];

/**
 * Parent document a cold offline navigation to `href` is served from,
 * keeping the requested URL. null = not restorable (use /offline).
 */
export function coldLoadParentPath(href: string): string | null {
  if (isGestionarCajaDetail(href)) return "/mas/caja/gestionar";
  const parsed = parseEntityHref(href);
  if (!parsed) return null;
  if (parsed.action && COLD_LOAD_ONLINE_ONLY.includes(parsed.action)) return null;
  return entityParentPath(href);
}

/** Regex sources (no flags, case-insensitive) of cold-load-restorable ficha URLs, for the inline boot script. */
export function bootEntityPatternSources(): string[] {
  return [
    `^/inventario/${UUID}(?:/(?:${PRODUCT_ACTIONS.join("|")}))?$`,
    `^/clientes/${UUID}(?:/abono)?$`,
    `^/inventario/proveedores/${UUID}$`,
    `^/ventas/${UUID}(?:/devolver)?$`,
  ];
}
