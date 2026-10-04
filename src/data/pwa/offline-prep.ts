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
import { formatStorageProbeDetail, readOriginStorage } from "./origin-storage";
import {
  DASHBOARD_SNAPSHOT_KIND,
  loadDashboardWithOfflineFallback,
  loadStatsWithOfflineFallback,
  statsSnapshotKind,
} from "./offline-snapshots";
import {
  HISTORY_RESOURCES,
  warmCashHistory,
  warmLedgerHistory,
  warmMoveHistory,
  warmSalesHistory,
} from "./offline-history";

export const PREP_VERSION = 9;
export const PREP_DOCUMENT_CACHE = "documents";

export type PrepTaskGroup = "app" | "catalogos" | "historial" | "resumen" | "sistema";

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
    { path: "/mas", label: "Documento Más" },
    { path: "/mas/caja", label: "Documento Caja" },
    { path: "/mas/gastos", label: "Documento Gastos" },
    { path: "/mas/gastos/nuevo", label: "Documento Nuevo gasto" },
    { path: "/mas/caja/aporte", label: "Documento Aporte" },
    { path: "/mas/caja/retiro", label: "Documento Retiro" },
    { path: "/mas/caja/cerrar", label: "Documento Cerrar caja" },
    { path: "/mas/estadisticas", label: "Documento Estadísticas" },
    { path: "/mas/apariencia", label: "Documento Apariencia" },
    // The supplier list is a segment of /inventario. There is no
    // /inventario/proveedores page, so that path is not a document.
    { path: "/inventario/proveedores/nuevo", label: "Documento Nuevo proveedor" },
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
 * Dynamic entity documents are not part of preparation. Fichas open from
 * the already-loaded shell and IndexedDB. A cold load of /inventario/[id]
 * (and the other entity URLs) stays on the service worker /offline fallback.
 */
export function requiredStaticDocuments(): string[] {
  return prepTaskDefs()
    .filter((task) => task.key.startsWith("doc:"))
    .map((task) => task.key.slice(4));
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
  if (!(await staticDocumentsPresent())) return { status: "stale", row };
  for (const resource of HISTORY_RESOURCES) {
    if (!(await db.cacheMeta.get(`${businessId}::${resource}`))) {
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

async function staticDocumentsPresent(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const scope = window as unknown as { caches?: CacheStorage };
  if (!scope.caches) return false;
  const cache = await scope.caches.open(PREP_DOCUMENT_CACHE);
  for (const path of requiredStaticDocuments()) {
    if (!(await cache.match(path))) return false;
  }
  return true;
}

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
  // Measure only. persist() is reserved for the explicit button on /sincronizacion.
  const snapshot = await readOriginStorage();
  return formatStorageProbeDetail(snapshot);
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
 * Full ordered task list for one run: service worker, static screens,
 * catalogs, summaries, thumbnails, storage, verification.
 * Entity fichas are not documents. Shared by the runner and the UI.
 */
export async function buildPrepTaskDefs(
  businessId: string,
  details: Map<string, string> = new Map(),
): Promise<{ defs: PrepTaskDef[]; details: Map<string, string> }> {
  const wrap = (key: string, run: () => Promise<string | void>) => async () => {
    const detail = await run();
    if (typeof detail === "string") details.set(key, detail);
  };
  const base = prepTaskDefs();
  const documents = base.filter((task) => task.key.startsWith("doc:"));
  const catalogs = base.filter((task) => task.key.startsWith("catalog:"));
  const snapshots = base.filter((task) => task.key.startsWith("snapshot:"));
  const defs: PrepTaskDef[] = [
    { key: "sys:sw", group: "sistema", label: "Service Worker", run: wrap("sys:sw", checkServiceWorker) },
    ...documents,
    ...catalogs,
    { key: "history:sales", group: "historial", label: "Ventas", run: wrap("history:sales", () => warmSalesHistory(businessId)) },
    { key: "history:ledgers", group: "historial", label: "Fiados", run: wrap("history:ledgers", () => warmLedgerHistory(businessId)) },
    { key: "history:cash", group: "historial", label: "Caja", run: wrap("history:cash", () => warmCashHistory(businessId)) },
    { key: "history:moves", group: "historial", label: "Movimientos", run: wrap("history:moves", () => warmMoveHistory(businessId)) },
    ...snapshots,
    { key: "media:thumbs", group: "resumen", label: "Miniaturas de productos", run: wrap("media:thumbs", () => warmPrimaryThumbs(businessId)) },
    { key: "sys:storage", group: "sistema", label: "Almacenamiento", run: wrap("sys:storage", checkStorage) },
    {
      key: "sys:verify",
      group: "sistema",
      label: "Verificación",
      run: async () => {
        const warmed = requiredStaticDocuments();
        details.set("sys:verify", await verifyPreparation(businessId, warmed));
      },
    },
  ];
  return { defs, details };
}

async function taskSatisfied(businessId: string, key: string): Promise<boolean> {
  const db = getLocalDb();
  if (key.startsWith("catalog:")) {
    return Boolean(await db.cacheMeta.get(`${businessId}::${key.slice("catalog:".length)}`));
  }
  if (key.startsWith("history:")) {
    return Boolean(await db.cacheMeta.get(`${businessId}::${key}`));
  }
  if (key.startsWith("snapshot:")) {
    return Boolean(await db.snapshots.get(`${businessId}::${key.slice(9)}`));
  }
  if (key.startsWith("doc:") && typeof window !== "undefined") {
    const scope = window as unknown as { caches?: CacheStorage };
    if (!scope.caches) return false;
    const cache = await scope.caches.open(PREP_DOCUMENT_CACHE);
    return Boolean(await cache.match(key.slice(4)));
  }
  return false;
}

const activeRuns = new Map<string, Promise<PrepReadiness>>();

/**
 * Runs every preparation task sequentially and persists the outcome.
 * Concurrent callers for the same business observe the same run.
 */
export function runPreparation(
  businessId: string,
  onProgress?: (progress: PrepProgress) => void,
  options?: { refresh?: boolean },
): Promise<PrepReadiness> {
  assertUuid(businessId, "businessId");
  const active = activeRuns.get(businessId);
  if (active) return active;
  const task = runPreparationInternal(businessId, onProgress, options?.refresh === true);
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
  refresh = false,
): Promise<PrepReadiness> {
  const db = getLocalDb();
  const { defs, details } = await buildPrepTaskDefs(businessId);
  const records: PrepTaskRecord[] = [];
  let completed = 0;
  const detailOf = (key: string): string | null => details.get(key) ?? null;
  for (const def of defs) {
    onProgress?.({ key: def.key, status: "running", error: null, completed, total: defs.length });
    try {
      if (!refresh && (await taskSatisfied(businessId, def.key))) {
        completed += 1;
        records.push({ key: def.key, status: "done", error: null, finishedAt: Date.now(), detail: "Ya preparado" });
        onProgress?.({ key: def.key, status: "done", error: null, detail: "Ya preparado", completed, total: defs.length });
        continue;
      }
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
