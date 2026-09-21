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

export const PREP_VERSION = 1;
export const PREP_DOCUMENT_CACHE = "documents";

export type PrepTaskGroup = "app" | "catalogos";

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
  ];
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
  return { status: "ready", row };
}

export type PrepProgress = {
  key: string;
  status: PrepTaskStatus;
  error: string | null;
  completed: number;
  total: number;
};

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
  const defs = prepTaskDefs();
  const records: PrepTaskRecord[] = [];
  let completed = 0;
  for (const def of defs) {
    onProgress?.({ key: def.key, status: "running", error: null, completed, total: defs.length });
    try {
      await def.run();
      completed += 1;
      records.push({ key: def.key, status: "done", error: null, finishedAt: Date.now() });
      onProgress?.({ key: def.key, status: "done", error: null, completed, total: defs.length });
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
