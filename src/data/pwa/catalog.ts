import type {
  RemoteCustomer,
  RemoteProduct,
  RemoteSupplier,
} from "../http/mappers";
import { getCatalogReadCache } from "../local/read-cache";
import { getPwaApi } from "./api";

function requireBusinessId(): string {
  const businessId = getPwaApi().session.businessId;
  if (!businessId) {
    throw new Error("Selecciona un negocio.");
  }
  return businessId;
}

export async function listCachedProducts(): Promise<RemoteProduct[]> {
  const api = getPwaApi();
  const result = await getCatalogReadCache().listProducts(
    requireBusinessId(),
    () => api.products.list(),
  );
  return result.data;
}

export async function listCachedCustomers(): Promise<RemoteCustomer[]> {
  const api = getPwaApi();
  const result = await getCatalogReadCache().listCustomers(
    requireBusinessId(),
    () => api.customers.list(),
  );
  return result.data;
}

export async function listCachedSuppliers(): Promise<RemoteSupplier[]> {
  const api = getPwaApi();
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
