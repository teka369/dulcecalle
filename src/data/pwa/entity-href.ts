/**
 * Entity fichas are client views. Offline, an already-loaded app opens
 * them from IndexedDB instead of requesting a per-entity document.
 * A cold load of these URLs is not handled here: the service worker
 * still falls back to /offline.
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
