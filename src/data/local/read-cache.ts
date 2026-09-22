/**
 * M6.3 catalog read cache. GET online writes a tenant snapshot; NetworkError
 * reads it back. Not an outbox, not a sync engine. PostgreSQL is the authority.
 */
import { ApiError, isNetworkError } from "../errors";
import type {
  RemoteCustomer,
  RemoteProduct,
  RemoteSupplier,
} from "../http/mappers";
import { getLocalDb, type DulceCalleLocalDB } from "./db";
import { assertUuid } from "./ids";
import { getLocalStore, LocalStore } from "./store";
import type {
  CatalogResource,
  LocalCacheMeta,
  LocalCustomer,
  LocalProduct,
  LocalSupplier,
} from "./types";

export type CachedList<T> = {
  data: T[];
  source: "server" | "cache";
  cachedAt: number | null;
};

function metaId(businessId: string, resource: CatalogResource): string {
  return `${businessId}::${resource}`;
}

export function productToLocal(
  row: RemoteProduct,
  businessId: string,
  cachedAt: number,
): LocalProduct {
  return {
    id: row.id,
    businessId,
    name: row.name,
    category: row.category,
    price: row.price,
    avgCost: row.avgCost,
    stock: row.stock,
    lowStockAt: row.lowStockAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: cachedAt,
    images: row.images.map((img) => ({ ...img })),
  };
}

export function productToRemote(row: LocalProduct): RemoteProduct {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    avgCost: row.avgCost,
    stock: row.stock,
    lowStockAt: row.lowStockAt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    images: row.images.map((img) => ({ ...img })),
  };
}

export function customerToLocal(
  row: RemoteCustomer,
  businessId: string,
  cachedAt: number,
): LocalCustomer {
  return {
    id: row.id,
    businessId,
    code: row.code,
    name: row.name,
    phone: row.phone,
    debt: row.debt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: cachedAt,
  };
}

export function customerToRemote(row: LocalCustomer): RemoteCustomer {
  return {
    id: row.id,
    code: row.code ?? "",
    name: row.name,
    phone: row.phone,
    debt: row.debt,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
  };
}

export function supplierToLocal(
  row: RemoteSupplier,
  businessId: string,
  cachedAt: number,
): LocalSupplier {
  return {
    id: row.id,
    businessId,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: cachedAt,
  };
}

export function supplierToRemote(row: LocalSupplier): RemoteSupplier {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

export class CatalogReadCache {
  constructor(
    private readonly store: LocalStore = getLocalStore(),
    private readonly db: DulceCalleLocalDB = getLocalDb(),
  ) {}

  async listProducts(
    businessId: string,
    fetch: () => Promise<RemoteProduct[]>,
  ): Promise<CachedList<RemoteProduct>> {
    return this.list({
      businessId,
      resource: "products",
      fetch,
      toLocal: productToLocal,
      toRemote: productToRemote,
      replaceAll: (biz, rows) => this.store.products.replaceAll(biz, rows),
      list: (biz) => this.store.products.list(biz),
    });
  }

  async listCustomers(
    businessId: string,
    fetch: () => Promise<RemoteCustomer[]>,
  ): Promise<CachedList<RemoteCustomer>> {
    return this.list({
      businessId,
      resource: "customers",
      fetch,
      toLocal: customerToLocal,
      toRemote: customerToRemote,
      replaceAll: (biz, rows) => this.store.customers.replaceAll(biz, rows),
      list: (biz) => this.store.customers.list(biz),
    });
  }

  async listSuppliers(
    businessId: string,
    fetch: () => Promise<RemoteSupplier[]>,
  ): Promise<CachedList<RemoteSupplier>> {
    return this.list({
      businessId,
      resource: "suppliers",
      fetch,
      toLocal: supplierToLocal,
      toRemote: supplierToRemote,
      replaceAll: (biz, rows) => this.store.suppliers.replaceAll(biz, rows),
      list: (biz) => this.store.suppliers.list(biz),
    });
  }

  async getProduct(
    businessId: string,
    id: string,
    fetch: () => Promise<RemoteProduct>,
  ): Promise<RemoteProduct> {
    return this.getOne({
      businessId,
      id,
      fetch,
      toLocal: productToLocal,
      toRemote: productToRemote,
      put: (row) => this.store.products.put(row),
      get: (biz, rowId) => this.store.products.get(biz, rowId),
    });
  }

  async getCustomer(
    businessId: string,
    id: string,
    fetch: () => Promise<RemoteCustomer>,
  ): Promise<RemoteCustomer> {
    return this.getOne({
      businessId,
      id,
      fetch,
      toLocal: customerToLocal,
      toRemote: customerToRemote,
      put: (row) => this.store.customers.put(row),
      get: (biz, rowId) => this.store.customers.get(biz, rowId),
    });
  }

  async getSupplier(
    businessId: string,
    id: string,
    fetch: () => Promise<RemoteSupplier>,
  ): Promise<RemoteSupplier> {
    return this.getOne({
      businessId,
      id,
      fetch,
      toLocal: supplierToLocal,
      toRemote: supplierToRemote,
      put: (row) => this.store.suppliers.put(row),
      get: (biz, rowId) => this.store.suppliers.get(biz, rowId),
    });
  }

  async cachedAt(
    businessId: string,
    resource: CatalogResource,
  ): Promise<number | null> {
    assertUuid(businessId, "businessId");
    const row = await this.db.cacheMeta.get(metaId(businessId, resource));
    return row?.cachedAt ?? null;
  }

  private async list<TRemote, TLocal extends { id: string; businessId: string }>(opts: {
    businessId: string;
    resource: CatalogResource;
    fetch: () => Promise<TRemote[]>;
    toLocal: (row: TRemote, businessId: string, cachedAt: number) => TLocal;
    toRemote: (row: TLocal) => TRemote;
    replaceAll: (businessId: string, rows: TLocal[]) => Promise<void>;
    list: (businessId: string) => Promise<TLocal[]>;
  }): Promise<CachedList<TRemote>> {
    assertUuid(opts.businessId, "businessId");
    try {
      const data = await opts.fetch();
      const cachedAt = Date.now();
      const locals = data.map((row) =>
        opts.toLocal(row, opts.businessId, cachedAt),
      );
      await opts.replaceAll(opts.businessId, [
        ...locals,
        ...(await this.pendingLocalRows(opts)),
      ]);
      await this.writeMeta(opts.businessId, opts.resource, cachedAt);
      return { data, source: "server", cachedAt };
    } catch (e) {
      this.rethrowUnlessNetwork(e);
      const meta = await this.db.cacheMeta.get(
        metaId(opts.businessId, opts.resource),
      );
      if (!meta) throw e;
      const rows = await opts.list(opts.businessId);
      return {
        data: rows.map(opts.toRemote),
        source: "cache",
        cachedAt: meta.cachedAt,
      };
    }
  }

  private async getOne<TRemote, TLocal extends { id: string; businessId: string }>(opts: {
    businessId: string;
    id: string;
    fetch: () => Promise<TRemote>;
    toLocal: (row: TRemote, businessId: string, cachedAt: number) => TLocal;
    toRemote: (row: TLocal) => TRemote;
    put: (row: TLocal) => Promise<void>;
    get: (businessId: string, id: string) => Promise<TLocal | undefined>;
  }): Promise<TRemote> {
    assertUuid(opts.businessId, "businessId");
    assertUuid(opts.id, "id");
    try {
      const row = await opts.fetch();
      await opts.put(opts.toLocal(row, opts.businessId, Date.now()));
      return row;
    } catch (e) {
      this.rethrowUnlessNetwork(e);
      const cached = await opts.get(opts.businessId, opts.id);
      if (!cached) throw e;
      return opts.toRemote(cached);
    }
  }

  /**
   * D2 — An online refresh must never delete a local row that still has a
   * non-synced outbox operation. Server rows always win by id; client-minted
   * pending rows (unknown to the server) are carried over untouched.
   */
  private async pendingLocalRows<
    TLocal extends { id: string; businessId: string },
  >(opts: {
    businessId: string;
    list: (businessId: string) => Promise<TLocal[]>;
  }): Promise<TLocal[]> {
    const pendingRequestIds = new Set<string>();
    for (const status of ["pending", "failed", "in_flight"] as const) {
      const items = await this.db.outbox
        .where("[businessId+status]")
        .equals([opts.businessId, status])
        .toArray();
      for (const item of items) pendingRequestIds.add(item.requestId);
    }
    if (pendingRequestIds.size === 0) return [];
    const current = await opts.list(opts.businessId);
    return current.filter((row) => {
      const requestId = (row as { requestId?: unknown }).requestId;
      return typeof requestId === "string" && pendingRequestIds.has(requestId);
    });
  }

  private rethrowUnlessNetwork(e: unknown): void {
    if (isNetworkError(e)) return;
    if (e instanceof ApiError) throw e;
    throw e;
  }

  private async writeMeta(
    businessId: string,
    resource: CatalogResource,
    cachedAt: number,
  ): Promise<void> {
    const row: LocalCacheMeta = {
      id: metaId(businessId, resource),
      businessId,
      resource,
      cachedAt,
    };
    await this.db.cacheMeta.put(row);
  }
}

let singleton: CatalogReadCache | null = null;

export function getCatalogReadCache(): CatalogReadCache {
  if (!singleton) singleton = new CatalogReadCache();
  return singleton;
}

export function resetCatalogReadCache(): void {
  singleton = null;
}
