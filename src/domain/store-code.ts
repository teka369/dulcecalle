/**
 * Store code shown to the owner and typed by customers in the portal when
 * their code exists in 2+ stores: the first 8 hex characters of the store
 * (business) id. The backend matches it case-insensitively
 * (customer-access.service.ts `storeMatches`).
 */
export function storeCode(businessId: string): string {
  return businessId.slice(0, 8).toUpperCase();
}

/** Absolute portal link that pins the store, so the store step never shows. */
export function portalLink(origin: string, businessId: string): string {
  return `${origin.replace(/\/+$/, "")}/cliente/login?tienda=${encodeURIComponent(businessId)}`;
}
