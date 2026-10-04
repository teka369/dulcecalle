/**
 * Origin storage status for this site (navigator.storage).
 * A read never calls persist(). Only requestOriginPersistence() does,
 * and only when the user asks.
 *
 * Persistent storage is not a backup, not PostgreSQL, and not proof that
 * an unsynced sale is safe. A false result does not delete anything.
 */

export const STORAGE_WARNING_RATIO = 0.8;

export type OriginStorageError = "unsupported" | "persisted" | "estimate" | "persist" | null;

export type OriginStorageSnapshot = {
  supported: boolean;
  persistent: boolean | null;
  usage: number | null;
  quota: number | null;
  usagePercent: number | null;
  warning: boolean;
  error: OriginStorageError;
};

/** A read leaves persistResult null. A request records what persist() returned. */
export type OriginStorageAction = OriginStorageSnapshot & {
  persistResult: boolean | null;
};

export type OriginStorageEstimate = {
  usage?: number;
  quota?: number;
};

export type OriginStorageProbe = {
  persisted?: () => Promise<boolean>;
  estimate?: () => Promise<OriginStorageEstimate>;
  persist?: () => Promise<boolean>;
};

const UNSUPPORTED: OriginStorageSnapshot = {
  supported: false,
  persistent: null,
  usage: null,
  quota: null,
  usagePercent: null,
  warning: false,
  error: "unsupported",
};

export function browserOriginStorageProbe(): OriginStorageProbe | null {
  try {
    const nav = (globalThis as { navigator?: { storage?: OriginStorageProbe } }).navigator;
    return nav?.storage ?? null;
  } catch {
    return null;
  }
}

function finiteByte(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Quota must be a positive finite number. Zero or missing is "not available", not zero free space. */
function finiteQuota(value: unknown): number | null {
  const n = finiteByte(value);
  if (n == null || n <= 0) return null;
  return n;
}

export function storageUsagePercent(usage: number | null, quota: number | null): number | null {
  if (usage == null || quota == null) return null;
  if (!Number.isFinite(usage) || !Number.isFinite(quota)) return null;
  if (usage < 0 || quota <= 0) return null;
  return usage / quota;
}

export function storageWarning(percent: number | null): boolean {
  return percent != null && percent >= STORAGE_WARNING_RATIO;
}

function finish(partial: {
  supported: boolean;
  persistent: boolean | null;
  usage: number | null;
  quota: number | null;
  error: OriginStorageError;
}): OriginStorageSnapshot {
  const usagePercent = storageUsagePercent(partial.usage, partial.quota);
  return { ...partial, usagePercent, warning: storageWarning(usagePercent) };
}

export async function readOriginStorage(
  probe: OriginStorageProbe | null = browserOriginStorageProbe(),
): Promise<OriginStorageSnapshot> {
  if (!probe || (typeof probe.persisted !== "function" && typeof probe.estimate !== "function")) {
    return { ...UNSUPPORTED };
  }
  let persistent: boolean | null = null;
  let error: OriginStorageError = null;
  if (typeof probe.persisted !== "function") {
    error = "persisted";
  } else {
    try {
      const value = await probe.persisted();
      if (value === true || value === false) persistent = value;
      else error = "persisted";
    } catch {
      persistent = null;
      error = "persisted";
    }
  }
  let usage: number | null = null;
  let quota: number | null = null;
  if (typeof probe.estimate !== "function") {
    error = error ?? "estimate";
  } else {
    try {
      const estimate = await probe.estimate();
      usage = finiteByte(estimate?.usage);
      quota = finiteQuota(estimate?.quota);
    } catch {
      usage = null;
      quota = null;
      error = "estimate";
    }
  }
  return finish({ supported: true, persistent, usage, quota, error });
}

/**
 * Explicit user action. Checks that persist() exists, calls it, then reads
 * persisted() and estimate() again. false is a normal result, not a throw.
 * A throw does not mean the data was deleted.
 */
export async function requestOriginPersistence(
  probe: OriginStorageProbe | null = browserOriginStorageProbe(),
): Promise<OriginStorageAction> {
  if (!probe || typeof probe.persist !== "function") {
    const read = await readOriginStorage(probe);
    return { ...read, supported: false, persistResult: null, error: "unsupported" };
  }
  let persistResult: boolean;
  try {
    const value = await probe.persist();
    if (value !== true && value !== false) {
      const read = await readOriginStorage(probe);
      return { ...read, persistResult: null, error: "persist" };
    }
    persistResult = value;
  } catch {
    const read = await readOriginStorage(probe);
    return { ...read, persistResult: null, error: "persist" };
  }
  const read = await readOriginStorage(probe);
  return { ...read, persistResult };
}

export function formatApproxMb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function storageUsageLine(snapshot: OriginStorageSnapshot): string | null {
  if (snapshot.usage == null) return null;
  return `Uso aproximado: ${formatApproxMb(snapshot.usage)}`;
}

export function storageQuotaLine(snapshot: OriginStorageSnapshot): string | null {
  if (snapshot.quota == null) return null;
  return `Límite aproximado que el navegador asigna a este sitio: ${formatApproxMb(snapshot.quota)}.`;
}

export function storagePercentLine(snapshot: OriginStorageSnapshot): string | null {
  if (snapshot.usagePercent == null) return null;
  const percent = Math.round(snapshot.usagePercent * 100);
  return `Aproximadamente ${percent} % de ese límite. No es el espacio libre del teléfono.`;
}

export function storageWarningLine(snapshot: OriginStorageSnapshot): string | null {
  if (!snapshot.warning) return null;
  return "Queda poco espacio para este sitio. Es una estimación del navegador sobre el límite de este sitio, no el espacio libre del teléfono.";
}

export function storageMissingUsageLine(snapshot: OriginStorageSnapshot): string | null {
  if (snapshot.usage != null) return null;
  if (!snapshot.supported || snapshot.error === "unsupported") return null;
  if (snapshot.error === "estimate") {
    return "No se pudo consultar el uso aproximado. No muestro una cifra.";
  }
  return "El navegador no informó cuánto espacio usa este sitio.";
}

export const STORAGE_BACKUP_NOTE =
  "La protección del almacenamiento no es una copia de seguridad. Una copia de seguridad será una función independiente en una fase posterior.";

export const STORAGE_NOT_A_BACKUP_BUTTON =
  "Esto reduce el riesgo de que el navegador elimine automáticamente los datos por presión de almacenamiento. No es una copia de seguridad.";

export const STORAGE_PERSISTENT_LIMIT =
  "Esto no sustituye una copia de seguridad y no evita que el usuario borre los datos del sitio, borre los datos del navegador o desinstale el navegador.";

export type StorageProtectionCopy = {
  title: string;
  body: string;
};

export function storageProtectionCopy(snapshot: OriginStorageSnapshot): StorageProtectionCopy {
  if (!snapshot.supported || snapshot.error === "unsupported") {
    return {
      title: "Almacenamiento de este dispositivo",
      body: "Este navegador no permite consultar o solicitar esta protección.",
    };
  }
  if (snapshot.persistent === true) {
    return {
      title: "Almacenamiento protegido",
      body: "El navegador ha marcado los datos de este sitio como almacenamiento persistente, por lo que no debería eliminarlos automáticamente debido a presión de almacenamiento.",
    };
  }
  if (snapshot.persistent === false) {
    return {
      title: "Almacenamiento de este dispositivo",
      body: "Tus datos locales pueden permanecer aunque cierres la aplicación, pero el navegador puede eliminarlos automáticamente bajo determinadas condiciones de almacenamiento.",
    };
  }
  return {
    title: "Almacenamiento de este dispositivo",
    body: "No se pudo saber si el navegador protege los datos de este sitio. No asumo que estén protegidos.",
  };
}

export function storageRequestMessage(action: OriginStorageAction): string | null {
  if (action.error === "unsupported" || !action.supported) {
    return "Este navegador no permite consultar o solicitar esta protección.";
  }
  if (action.error === "persist") {
    return "No se pudo solicitar la protección. No se borró nada. Puedes intentarlo otra vez.";
  }
  if (action.persistResult === null) return null;
  if (action.persistent === true) {
    return "El navegador ha concedido protección contra el borrado automático por presión de almacenamiento.";
  }
  if (action.persistResult === false || action.persistent === false) {
    return "El navegador no concedió esta protección. Tus datos locales siguen disponibles, pero permanecen sujetos a las reglas normales de almacenamiento del navegador.";
  }
  return "No se pudo confirmar si el navegador concedió la protección. No se borró nada. Puedes intentarlo otra vez.";
}

/** Short diagnostic for offline preparation. Does not request persistence. */
export function formatStorageProbeDetail(snapshot: OriginStorageSnapshot): string {
  if (!snapshot.supported || snapshot.usage == null) {
    throw new Error("Este navegador no expone uso de almacenamiento.");
  }
  const base =
    snapshot.quota != null
      ? `${formatApproxMb(snapshot.usage)} de ${formatApproxMb(snapshot.quota)}`
      : `${formatApproxMb(snapshot.usage)} usados`;
  const protection =
    snapshot.persistent == null ? "no se pudo consultar" : snapshot.persistent ? "sí" : "no";
  return `${base} · protección: ${protection}`;
}
