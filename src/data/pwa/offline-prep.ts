/**
 * Offline preparation (readiness): while online, warm everything the
 * offline flows need so the user never has to "teach" the app page by
 * page. Read-only: it never creates business operations, never touches
 * the outbox, never fabricates data.
 *
 * Two task families, both derived from the real offline flows:
 * - documents: route shells cached under their own URL (SW documents
 *   cache), so an offline reload boots where the user was;
 * - catalogs: the admin read-cache snapshots offline writes depend on.
 */
import { NetworkError } from "../errors";
import { getLocalDb } from "../local/db";
import type { PrepReadiness, PrepTaskRecord, PrepTaskStatus } from "../local/types";
import { assertUuid } from "../local/ids";
import {
  listCachedCustomers,
  listCachedProducts,
  listCachedSuppliers,
} from "./catalog";
import {
  DASHBOARD_SNAPSHOT_KIND,
  loadDashboardWithOfflineFallback,
  loadStatsWithOfflineFallback,
  statsSnapshotKind,
} from "./offline-snapshots";

export const PREP_VERSION = 3;
export const PREP_DOCUMENT_CACHE = "documents";

export type PrepTaskGroup = "app" | "catalogos" | "resumen" | "sistema";

export type PrepTaskDef = {
  key: string;
  group: PrepTaskGroup;
  label: string;
  run: () => Promise<void>;
};

function readinessId(businessId: string): string {
  return `readiness::${businessId}`;
}

async function warmDocument(path: string): Promise<void> {
  if (typeof window === "undefined" || !("caches" in window)) {
    throw new Error("Este dispositivo no soporta cache de documentos.");
  }
  const scope = window as unknown as {
    navigator: Navigator & { serviceWorker?: { controller: unknown } };
    caches: CacheStorage;
  };
  if (!scope.navigator.serviceWorker?.controller) {
    throw new Error("Service Worker aún no activo. Recarga la página e inténtalo de nuevo.");
  }
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
    throw new NetworkError("Sin conexión.");
  }
  if (!response.ok) {
    throw new Error(`No se pudo cargar ${path} (${response.status}).`);
  }
  await (await scope.caches.open(PREP_DOCUMENT_CACHE)).put(path, response);
}

export function prepTaskDefs(): PrepTaskDef[] {
  const documents: Array<{ path: string; label: string }> = [
    { path: "/", label: "Documento Inicio" },
    { path: "/ventas", label: "Documento Ventas" },
    { path: "/ventas/nueva", label: "Documento Nueva venta" },
    { path: "/ventas/cobrar", label: "Documento Cobrar" },
    { path: "/clientes", label: "Documento Clientes" },
    { path: "/clientes/nuevo", label: "Documento Nuevo cliente" },
    { path: "/inventario", label: "Documento Inventario" },
    { path: "/inventario/nuevo", label: "Documento Nuevo producto" },
    { path: "/mas/caja", label: "Documento Caja" },
    { path: "/mas/gastos", label: "Documento Gastos" },
    { path: "/inventario/proveedores", label: "Documento Proveedores" },
    { path: "/sincronizacion", label: "Documento Sincronización" },
  ];
  return [
    ...documents.map((d) => ({
      key: `doc:${d.path}`,
      group: "app" as const,
      label: d.label,
      run: () => warmDocument(d.path),
    })),
    {
      key: "catalog:products",
      group: "catalogos" as const,
      label: "Catálogo de productos",
      run: async () => {
        await listCachedProducts();
      },
    },
    {
      key: "catalog:customers",
      group: "catalogos" as const,
      label: "Catálogo de clientes",
      run: async () => {
        await listCachedCustomers();
      },
    },
    {
      key: "catalog:suppliers",
      group: "catalogos" as const,
      label: "Catálogo de proveedores",
      run: async () => {
        await listCachedSuppliers();
      },
    },
    {
      key: "snapshot:dashboard",
      group: "resumen" as const,
      label: "Resumen del inicio",
      run: async () => {
        await loadDashboardWithOfflineFallback();
      },
    },
    ...(["hoy", "semana", "mes"] as const).map((period) => ({
      key: `snapshot:${statsSnapshotKind(period)}`,
      group: "resumen" as const,
      label: `Estadísticas ${period}`,
      run: async () => {
        await loadStatsWithOfflineFallback(period);
      },
    })),
  ];
}

/**
 * Best-effort prefetch of primary product thumbnails into the SW image
 * cache, so catalogs render offline even for never-viewed products.
 * Only the small `thumb` variant; failures never fail preparation, the
 * count is reported in the task detail instead. Scoped to the business
 * being prepared — never warms another tenant's photos.
 */
async function warmPrimaryThumbs(businessId: string): Promise<string> {
  if (typeof window === "undefined" || !("caches" in window)) {
    return "0 miniaturas (sin Cache Storage)";
  }
  const scope = window as unknown as { caches?: CacheStorage };
  if (!scope.caches) return "0 miniaturas (sin Cache Storage)";
  const { getLocalDb } = await import("../local/db");
  const { variantUrl } = await import("../media/urls");
  const db = getLocalDb();
  const products = await db.products
    .where("businessId")
    .equals(businessId)
    .toArray();
  const cache = await scope.caches.open("cloudinary-images");
  let warmed = 0;
  let total = 0;
  for (const product of products) {
    const primary =
      product.images.find((img) => img.isPrimary) ?? product.images[0];
    if (!primary) continue;
    total += 1;
    try {
      const url = variantUrl(primary.secureUrl, "thumb");
      const hit = await cache.match(url);
      if (!hit) {
        const res = await fetch(url, { credentials: "omit" });
        if (res.ok) await cache.put(url, res);
        else continue;
      }
      warmed += 1;
    } catch {
      /* best-effort per image */
    }
  }
  return `${warmed}/${total} miniaturas`;
}

// Snapshot kinds the preparation guarantees. checkReadiness treats a
// missing one as stale so ready always implies fresh summaries.
export function requiredSnapshotKinds(): string[] {
  return [
    DASHBOARD_SNAPSHOT_KIND,
    statsSnapshotKind("hoy"),
    statsSnapshotKind("semana"),
    statsSnapshotKind("mes"),
  ];
}

/**
 * Dynamic documents for entities that actually exist in Dexie. Only
 * detail/action pages whose flows work offline are included; online-only
 * pages (devolver, deuda-inicial) are deliberately excluded.
 */
export async function dynamicDocumentTasks(businessId: string): Promise<PrepTaskDef[]> {
  const db = getLocalDb();
  const tasks: PrepTaskDef[] = [];
  const customers = await db.customers.where("businessId").equals(businessId).toArray();
  for (const c of customers) {
    tasks.push({
      key: `doc:/clientes/${c.id}`,
      group: "app" as const,
      label: `Documento cliente ${c.name}`,
      run: () => warmDocument(`/clientes/${c.id}`),
    });
    tasks.push({
      key: `doc:/clientes/${c.id}/abono`,
      group: "app" as const,
      label: `Documento abono ${c.name}`,
      run: () => warmDocument(`/clientes/${c.id}/abono`),
    });
  }
  const suppliers = await db.suppliers.where("businessId").equals(businessId).toArray();
  for (const s of suppliers) {
    tasks.push({
      key: `doc:/inventario/proveedores/${s.id}`,
      group: "app" as const,
      label: `Documento proveedor ${s.name}`,
      run: () => warmDocument(`/inventario/proveedores/${s.id}`),
    });
  }
  const products = await db.products.where("businessId").equals(businessId).toArray();
  for (const p of products) {
    tasks.push({
      key: `doc:/inventario/${p.id}`,
      group: "app" as const,
      label: `Documento producto ${p.name}`,
      run: () => warmDocument(`/inventario/${p.id}`),
    });
    tasks.push({
      key: `doc:/inventario/${p.id}/surtir`,
      group: "app" as const,
      label: `Documento surtir ${p.name}`,
      run: () => warmDocument(`/inventario/${p.id}/surtir`),
    });
  }
  const sales = await db.sales.where("businessId").equals(businessId).toArray();
  for (const s of sales) {
    tasks.push({
      key: `doc:/ventas/${s.id}`,
      group: "app" as const,
      label: `Documento venta ${s.id.slice(0, 8)}`,
      run: () => warmDocument(`/ventas/${s.id}`),
    });
  }
  return tasks;
}

export type ReadinessStatus = "ready" | "not_ready" | "stale" | "failed";

export async function checkReadiness(
  businessId: string,
): Promise<{ status: ReadinessStatus; row?: PrepReadiness }> {
  assertUuid(businessId, "businessId");
  const db = getLocalDb();
  const row = await db.prepState.get(readinessId(businessId));
  if (!row) return { status: "not_ready" };
  if (row.status === "failed") return { status: "failed", row };
  if (row.prepVersion !== PREP_VERSION || row.dbVersion !== db.verno) {
    return { status: "stale", row };
  }
  for (const resource of ["products", "customers", "suppliers"] as const) {
    if (!(await db.cacheMeta.get(`${businessId}::${resource}`))) {
      return { status: "stale", row };
    }
  }
  for (const kind of requiredSnapshotKinds()) {
    if (!(await db.snapshots.get(`${businessId}::${kind}`))) {
      return { status: "stale", row };
    }
  }
  return { status: "ready", row };
}

export type PrepProgress = {
  key: string;
  status: PrepTaskStatus;
  error: string | null;
  detail?: string | null;
  completed: number;
  total: number;
};

function swControlling(): boolean {
  if (typeof window === "undefined") return false;
  const sw = (
    window as unknown as {
      navigator?: Navigator & { serviceWorker?: { controller: unknown } };
    }
  ).navigator?.serviceWorker;
  return !!sw?.controller;
}

async function checkServiceWorker(): Promise<string> {
  if (!swControlling()) {
    throw new Error("Service Worker aún no controla esta página. Recarga e inténtalo de nuevo.");
  }
  return "Service Worker activo";
}

async function checkStorage(): Promise<string> {
  const storage = (
    globalThis as unknown as {
      navigator?: Navigator & {
        storage?: {
          estimate?: () => Promise<{ usage?: number; quota?: number }>;
          persist?: () => Promise<boolean>;
        };
      };
    }
  ).navigator?.storage;
  if (!storage?.estimate) throw new Error("Este navegador no expone uso de almacenamiento.");
  const { usage = 0, quota = 0 } = await storage.estimate();
  let persisted: boolean | null = null;
  try {
    if (storage.persist) persisted = await storage.persist();
  } catch {
    persisted = null;
  }
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
  const base = quota > 0 ? `${mb(usage)} de ${mb(quota)}` : `${mb(usage)} usados`;
  return persisted == null ? base : `${base} · persistente: ${persisted ? "sí" : "no"}`;
}

async function verifyPreparation(businessId: string, warmedPaths: string[]): Promise<string> {
  const scope = window as unknown as { caches?: CacheStorage };
  if (!scope.caches) throw new Error("Cache Storage no disponible.");
  const cache = await scope.caches.open(PREP_DOCUMENT_CACHE);
  const missing: string[] = [];
  for (const path of warmedPaths) {
    if (!(await cache.match(path))) missing.push(path);
  }
  if (missing.length > 0) {
    throw new Error(`Sin documento cacheado: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? "…" : ""}`);
  }
  const db = getLocalDb();
  for (const resource of ["products", "customers", "suppliers"] as const) {
    if (!(await db.cacheMeta.get(`${businessId}::${resource}`))) {
      throw new Error(`Sin snapshot de ${resource}.`);
    }
  }
  return `${warmedPaths.length} documentos verificados`;
}

/**
 * Full ordered task list for one run: sistema check, static documents,
 * dynamic entity documents, catalogs, storage check, final verification.
 * Shared by the runner and the UI so progress always covers every task.
 */
export async function buildPrepTaskDefs(
  businessId: string,
  details: Map<string, string> = new Map(),
): Promise<{ defs: PrepTaskDef[]; details: Map<string, string> }> {
  const dynamicDocs = await dynamicDocumentTasks(businessId);
  const wrap = (key: string, run: () => Promise<string | void>) => async () => {
    const detail = await run();
    if (typeof detail === "string") details.set(key, detail);
  };
  const defs: PrepTaskDef[] = [
    { key: "sys:sw", group: "sistema", label: "Service Worker", run: wrap("sys:sw", checkServiceWorker) },
    ...prepTaskDefs(),
    ...dynamicDocs,
    { key: "media:thumbs", group: "resumen", label: "Miniaturas de productos", run: wrap("media:thumbs", () => warmPrimaryThumbs(businessId)) },
    { key: "sys:storage", group: "sistema", label: "Almacenamiento", run: wrap("sys:storage", checkStorage) },
    {
      key: "sys:verify",
      group: "sistema",
      label: "Verificación",
      run: async () => {
        const warmed = defs
          .filter((d) => d.key.startsWith("doc:"))
          .map((d) => d.key.slice(4));
        details.set("sys:verify", await verifyPreparation(businessId, warmed));
      },
    },
  ];
  return { defs, details };
}

const activeRuns = new Map<string, Promise<PrepReadiness>>();

/**
 * Runs every preparation task sequentially and persists the outcome.
 * Concurrent callers for the same business observe the same run.
 */
export function runPreparation(
  businessId: string,
  onProgress?: (progress: PrepProgress) => void,
): Promise<PrepReadiness> {
  assertUuid(businessId, "businessId");
  const active = activeRuns.get(businessId);
  if (active) return active;
  const task = runPreparationInternal(businessId, onProgress);
  activeRuns.set(businessId, task);
  const cleanup = () => {
    if (activeRuns.get(businessId) === task) activeRuns.delete(businessId);
  };
  task.then(cleanup, cleanup);
  return task;
}

async function runPreparationInternal(
  businessId: string,
  onProgress?: (progress: PrepProgress) => void,
): Promise<PrepReadiness> {
  const db = getLocalDb();
  const { defs, details } = await buildPrepTaskDefs(businessId);
  const records: PrepTaskRecord[] = [];
  let completed = 0;
  const detailOf = (key: string): string | null => details.get(key) ?? null;
  for (const def of defs) {
    onProgress?.({ key: def.key, status: "running", error: null, completed, total: defs.length });
    try {
      await def.run();
      completed += 1;
      const detail = detailOf(def.key);
      records.push({ key: def.key, status: "done", error: null, finishedAt: Date.now(), detail });
      onProgress?.({ key: def.key, status: "done", error: null, detail, completed, total: defs.length });
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "No se pudo preparar.";
      records.push({ key: def.key, status: "failed", error: message, finishedAt: Date.now() });
      onProgress?.({ key: def.key, status: "failed", error: message, completed, total: defs.length });
    }
  }
  const row: PrepReadiness = {
    id: readinessId(businessId),
    businessId,
    status: completed === defs.length ? "ready" : "failed",
    prepVersion: PREP_VERSION,
    dbVersion: db.verno,
    completedAt: Date.now(),
    tasks: records,
  };
  await db.prepState.put(row);
  return row;
}
