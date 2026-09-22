import { useEffect, useState } from "react";
import { getLocalDb } from "../local/db";
import { getLocalStore } from "../local/store";
import { getCustomerAuthSession } from "../http/customer-session";
import { primaryImageUrl } from "../media/urls";

/** productId → primary secureUrl (null = placeholder). */
export type ProductImageMap = Map<string, string | null>;

/**
 * Resolves CURRENT catalog images for historical rows (sale lines, returns,
 * surtidas) that only carry productId + productName snapshots. Presentation
 * only: never touches financial data, never fetches over the network, so it
 * works offline whenever the catalog is cached. Unknown/archived/missing
 * products resolve to null → placeholder.
 */
export async function loadProductImageMap(
  businessId: string,
): Promise<ProductImageMap> {
  const map: ProductImageMap = new Map();
  try {
    const products = await getLocalStore().products.list(businessId);
    for (const p of products) {
      map.set(p.id, primaryImageUrl(p.images));
    }
  } catch {
    /* offline store unreadable: every row falls back to placeholder */
  }
  return map;
}

export function useProductImageMap(businessId: string | null): ProductImageMap {
  const [map, setMap] = useState<ProductImageMap>(new Map());
  useEffect(() => {
    if (!businessId) {
      setMap(new Map());
      return;
    }
    let live = true;
    void loadProductImageMap(businessId).then((next) => {
      if (live) setMap(next);
    });
    return () => {
      live = false;
    };
  }, [businessId]);
  return map;
}

/**
 * Portal counterpart: resolves images from the cached customer catalog
 * snapshot (keyed by customerId, public fields only). Same honesty rules as
 * the catalog cache: empty map when nothing was ever cached.
 */
export async function loadPortalImageMap(): Promise<ProductImageMap> {
  const map: ProductImageMap = new Map();
  try {
    const customerId = getCustomerAuthSession().customer?.id;
    if (!customerId) return map;
    const cached = await getLocalDb().portalCatalogs.get(customerId);
    for (const p of cached?.products ?? []) {
      const primary =
        p.images.find((img) => img.isPrimary) ??
        [...p.images].sort((a, b) => a.position - b.position)[0] ??
        null;
      map.set(p.id, primary?.secureUrl ?? null);
    }
  } catch {
    /* no snapshot: placeholder everywhere, catalog still renders */
  }
  return map;
}

export function usePortalImageMap(): ProductImageMap {
  const [map, setMap] = useState<ProductImageMap>(new Map());
  useEffect(() => {
    let live = true;
    void loadPortalImageMap().then((next) => {
      if (live) setMap(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return map;
}
