/**
 * Repository port (Fase 6.6 / 6.7).
 *
 * Same *operations* exist on Dexie repositories and HttpRepository.
 * IDs are NOT interchangeable yet:
 *   Dexie  → number (`++id`)
 *   HTTP   → UUID string
 *
 * Do not genericize the live Dexie types here. The UI still uses number.
 * After Dexie import, HTTP sessions use UUID; `import_id_map` rewrites FKs.
 * See IDENTITY.md.
 */

export type DexieEntityId = number;
export type RemoteEntityId = string;

export type Fase6CatalogOps =
  | "products.list"
  | "products.get"
  | "products.create"
  | "products.patch"
  | "customers.list"
  | "customers.get"
  | "customers.create";

export type Fase6SalesOps = "sales.create" | "sales.get" | "sales.list";

export type Fase6CashOps =
  | "cash.open"
  | "cash.today"
  | "cash.close"
  | "payments.create";

export type Fase6AuthOps =
  | "auth.register"
  | "auth.login"
  | "auth.logout"
  | "auth.me";
