import { NetworkError } from "../errors";
import {
  getCustomerApi,
  type CustomerCatalogProduct,
} from "../http/customer-api";
import { getCustomerAuthSession } from "../http/customer-session";
import { getLocalDb } from "../local/db";

export type CachedCustomerCatalog = {
  products: CustomerCatalogProduct[];
  source: "server" | "cache";
  capturedAt: number;
};

function requireCustomerId(): string {
  const id = getCustomerAuthSession().customer?.id;
  if (!id) throw new Error("Inicia sesión.");
  return id;
}

/**
 * Portal storefront catalog with the same honesty rules as the M6.10
 * ledger cache: online refreshes the snapshot, only a NetworkError serves
 * it back, anything else rethrows. Products carry public fields only.
 */
export async function loadCachedCustomerCatalog(): Promise<CachedCustomerCatalog> {
  const customerId = requireCustomerId();
  const db = getLocalDb();
  try {
    const products = await getCustomerApi().products();
    const capturedAt = Date.now();
    // Privacy 4a: catalog rows carry no customer id, so the verifiable guard is
    // that the session customer is still the one the request was made for.
    // Otherwise don't write it under this customerId (nor return it).
    if (getCustomerAuthSession().customer?.id !== customerId) throw new Error("Inicia sesión.");
    await db.portalCatalogs.put({ customerId, products, capturedAt });
    return { products, source: "server", capturedAt };
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const cached = await db.portalCatalogs.get(customerId);
    if (!cached) throw e;
    return { products: cached.products, source: "cache", capturedAt: cached.capturedAt };
  }
}

export function primaryCatalogImage(
  product: CustomerCatalogProduct,
): CustomerCatalogProduct["images"][number] | null {
  if (product.images.length === 0) return null;
  return (
    product.images.find((img) => img.isPrimary) ??
    [...product.images].sort((a, b) => a.position - b.position)[0] ??
    null
  );
}
