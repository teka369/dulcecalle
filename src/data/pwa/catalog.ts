import type {
  RemoteCustomer,
  RemoteProduct,
  RemoteSupplier,
} from "../http/mappers";
import type { HttpRepository } from "../http/repository";
import { getCatalogReadCache, type CachedList } from "../local/read-cache";
import { getPwaApi } from "./api";

function requireBusinessId(): string {
  const businessId = getPwaApi().session.businessId;
  if (!businessId) {
    throw new Error("Selecciona un negocio.");
  }
  return businessId;
}

/** Lists with where the rows came from (server or this device's cache). */
export function listCachedProductsResult(api: HttpRepository = getPwaApi()): Promise<CachedList<RemoteProduct>> {
  return getCatalogReadCache().listProducts(requireBusinessId(), () => api.products.list());
}

export function listCachedCustomersResult(api: HttpRepository = getPwaApi()): Promise<CachedList<RemoteCustomer>> {
  return getCatalogReadCache().listCustomers(requireBusinessId(), () => api.customers.list());
}

export function listCachedSuppliersResult(api: HttpRepository = getPwaApi()): Promise<CachedList<RemoteSupplier>> {
  return getCatalogReadCache().listSuppliers(requireBusinessId(), () => api.suppliers.list());
}

/** Local-only snapshot for a first paint while the server read is slow. Never throws. */
async function peekSafe<T>(read: (businessId: string) => Promise<T[] | null>): Promise<T[] | null> {
  try {
    const businessId = getPwaApi().session.businessId;
    if (!businessId) return null;
    return await read(businessId);
  } catch {
    return null;
  }
}

export function peekLocalProducts(): Promise<RemoteProduct[] | null> {
  return peekSafe((b) => getCatalogReadCache().peekProducts(b));
}

export function peekLocalCustomers(): Promise<RemoteCustomer[] | null> {
  return peekSafe((b) => getCatalogReadCache().peekCustomers(b));
}

export function peekLocalSuppliers(): Promise<RemoteSupplier[] | null> {
  return peekSafe((b) => getCatalogReadCache().peekSuppliers(b));
}

export async function listCachedProducts(api: HttpRepository = getPwaApi()): Promise<RemoteProduct[]> {
  const result = await getCatalogReadCache().listProducts(
    requireBusinessId(),
    () => api.products.list(),
  );
  return result.data;
}

export async function listCachedCustomers(api: HttpRepository = getPwaApi()): Promise<RemoteCustomer[]> {
  const result = await getCatalogReadCache().listCustomers(
    requireBusinessId(),
    () => api.customers.list(),
  );
  return result.data;
}

export async function listCachedSuppliers(api: HttpRepository = getPwaApi()): Promise<RemoteSupplier[]> {
  const result = await getCatalogReadCache().listSuppliers(
    requireBusinessId(),
    () => api.suppliers.list(),
  );
  return result.data;
}

export async function getCachedProduct(id: string): Promise<RemoteProduct> {
  const api = getPwaApi();
  return getCatalogReadCache().getProduct(requireBusinessId(), id, () =>
    api.products.get(id),
  );
}

export async function getCachedCustomer(id: string): Promise<RemoteCustomer> {
  const api = getPwaApi();
  return getCatalogReadCache().getCustomer(requireBusinessId(), id, () =>
    api.customers.get(id),
  );
}

export async function getCachedSupplier(id: string): Promise<RemoteSupplier> {
  const api = getPwaApi();
  return getCatalogReadCache().getSupplier(requireBusinessId(), id, () =>
    api.suppliers.get(id),
  );
}
