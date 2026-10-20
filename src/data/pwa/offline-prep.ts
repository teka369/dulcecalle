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
import { getPrepPwaApi } from "./api";
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

// 10: loop/v1 paged history lists (devices prepared at 9 re-download history).
export const PREP_VERSION = 10;
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
    throw new Error("Este teléfono no permite guardar pantallas para usar sin conexión.");
  }
  const scope = window as unknown as {
    navigator: Navigator & { serviceWorker?: { controller: unknown } };
    caches: CacheStorage;
  };
  if (!scope.navigator.serviceWorker?.controller) {
    throw new Error("El modo sin conexión aún no está listo. Recarga la página e inténtalo de nuevo.");
  }
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
    throw new NetworkError("Sin conexión.");
  }
  if (!response.ok) {
    throw new Error("No se pudo guardar esta pantalla. Inténtalo de nuevo.");
  }
  await (await scope.caches.open(PREP_DOCUMENT_CACHE)).put(path, response);
}

export function prepTaskDefs(): PrepTaskDef[] {
  const documents: Array<{ path: string; label: string }> = [
    { path: "/", label: "Pantalla Inicio" },
    { path: "/ventas", label: "Pantalla Ventas" },
    { path: "/ventas/nueva", label: "Pantalla Nueva venta" },
    { path: "/ventas/cobrar", label: "Pantalla Cobrar" },
    { path: "/clientes", label: "Pantalla Clientes" },
    { path: "/clientes/nuevo", label: "Pantalla Nuevo cliente" },
    { path: "/inventario", label: "Pantalla Inventario" },
    { path: "/inventario/nuevo", label: "Pantalla Nuevo producto" },
    { path: "/mas", label: "Pantalla Más" },
    { path: "/mas/caja", label: "Pantalla Caja" },
    { path: "/mas/gastos", label: "Pantalla Gastos" },
    { path: "/mas/gastos/nuevo", label: "Pantalla Nuevo gasto" },
    { path: "/mas/caja/aporte", label: "Pantalla Aporte" },
    { path: "/mas/caja/retiro", label: "Pantalla Retiro" },
    { path: "/mas/caja/cerrar", label: "Pantalla Cerrar caja" },
    // Server-only screen: offline it shows "Necesitas internet…". Also the
    // parent document for a cold offline load of /mas/caja/gestionar/[id].
    { path: "/mas/caja/gestionar", label: "Pantalla Gestionar cajas" },
    { path: "/mas/estadisticas", label: "Pantalla Estadísticas" },
    { path: "/mas/apariencia", label: "Pantalla Apariencia" },
    // The supplier list is a segment of /inventario. There is no
    // /inventario/proveedores page, so that path is not a document.
    { path: "/inventario/proveedores/nuevo", label: "Pantalla Nuevo proveedor" },
    { path: "/sincronizacion", label: "Pantalla Sincronización" },
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
        await listCachedProducts(getPrepPwaApi());
      },
    },
    {
      key: "catalog:customers",
      group: "catalogos" as const,
      label: "Catálogo de clientes",
      run: async () => {
        await listCachedCustomers(getPrepPwaApi());
      },
    },
    {
      key: "catalog:suppliers",
      group: "catalogos" as const,
      label: "Catálogo de proveedores",
      run: async () => {
        await listCachedSuppliers(getPrepPwaApi());
      },
    },
    {
      key: "snapshot:dashboard",
      group: "resumen" as const,
      label: "Resumen del inicio",
      run: async () => {
        await loadDashboardWithOfflineFallback(getPrepPwaApi());
      },
    },
    ...(["hoy", "semana", "mes"] as const).map((period) => ({
      key: `snapshot:${statsSnapshotKind(period)}`,
      group: "resumen" as const,
      label: `Estadísticas ${period}`,
      run: async () => {
        await loadStatsWithOfflineFallback(period, getPrepPwaApi());
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
    return "Sin fotos guardadas";
  }
  const scope = window as unknown as { caches?: CacheStorage };
  if (!scope.caches) return "Sin fotos guardadas";
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
  return `${warmed} de ${total} fotos`;
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
 * the already-loaded shell and IndexedDB; a cold offline load of an entity
 * URL is served its parent list document (/clientes, /inventario, /ventas,
 * /mas/caja/gestionar), which is in this list. Adding a document here makes
 * checkReadiness report existing devices as "stale" so they re-prepare.
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
    throw new Error("El modo sin conexión aún no está listo. Recarga la página e inténtalo de nuevo.");
  }
  return "Listo";
}

async function checkStorage(): Promise<string> {
  // Measure only. persist() is reserved for the explicit button on /sincronizacion.
  const snapshot = await readOriginStorage();
  return formatStorageProbeDetail(snapshot);
}

const RESOURCE_ES = { products: "productos", customers: "clientes", suppliers: "proveedores" } as const;

async function verifyPreparation(businessId: string, warmedPaths: string[]): Promise<string> {
  const scope = window as unknown as { caches?: CacheStorage };
  if (!scope.caches) throw new Error("Este teléfono no permite guardar pantallas para usar sin conexión.");
  const cache = await scope.caches.open(PREP_DOCUMENT_CACHE);
  const missing: string[] = [];
  for (const path of warmedPaths) {
    if (!(await cache.match(path))) missing.push(path);
  }
  if (missing.length > 0) {
    throw new Error(`Faltan ${missing.length} ${missing.length === 1 ? "pantalla" : "pantallas"} por guardar.`);
  }
  const db = getLocalDb();
  for (const resource of ["products", "customers", "suppliers"] as const) {
    if (!(await db.cacheMeta.get(`${businessId}::${resource}`))) {
      throw new Error(`Faltan datos de ${RESOURCE_ES[resource]}.`);
    }
  }
  return `${warmedPaths.length} pantallas revisadas`;
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
    { key: "sys:sw", group: "sistema", label: "Modo sin conexión", run: wrap("sys:sw", checkServiceWorker) },
    ...documents,
    ...catalogs,
    { key: "history:sales", group: "historial", label: "Ventas", run: wrap("history:sales", () => warmSalesHistory(businessId)) },
    { key: "history:ledgers", group: "historial", label: "Fiados", run: wrap("history:ledgers", () => warmLedgerHistory(businessId)) },
    { key: "history:cash", group: "historial", label: "Caja", run: wrap("history:cash", () => warmCashHistory(businessId)) },
    { key: "history:moves", group: "historial", label: "Movimientos", run: wrap("history:moves", () => warmMoveHistory(businessId)) },
    ...snapshots,
    { key: "media:thumbs", group: "resumen", label: "Fotos de productos", run: wrap("media:thumbs", () => warmPrimaryThumbs(businessId)) },
    { key: "sys:storage", group: "sistema", label: "Espacio en el teléfono", run: wrap("sys:storage", checkStorage) },
    {
      key: "sys:verify",
      group: "sistema",
      label: "Revisión",
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

/** How long first-install prep waits for the service worker to take control. */
export const SW_CONTROL_WAIT_MS = 20_000;

/**
 * B6: on a first install the SW registers, activates and claims the page a
 * few seconds after load. Prep must not start its document tasks before the
 * page is controlled (they would all fail with "Service Worker aún no
 * activo"). Waits for navigator.serviceWorker.ready, then for a controller
 * (clientsClaim → controllerchange), bounded by `timeoutMs`. Resolves
 * whether or not control arrived; the doc tasks still report honestly.
 */
export async function waitForServiceWorkerControl(timeoutMs = SW_CONTROL_WAIT_MS): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const sw = (window as unknown as { navigator?: Navigator }).navigator?.serviceWorker;
  if (!sw) return false;
  if (sw.controller) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const controlled = (async () => {
    if (sw.ready) await sw.ready;
    if (sw.controller) return true;
    await new Promise<void>((resolve) => {
      if (typeof sw.addEventListener !== "function") return;
      sw.addEventListener("controllerchange", () => resolve(), { once: true });
    });
    return true;
  })();
  try {
    return await Promise.race([controlled, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runPreparationInternal(
  businessId: string,
  onProgress?: (progress: PrepProgress) => void,
  refresh = false,
): Promise<PrepReadiness> {
  await waitForServiceWorkerControl();
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
