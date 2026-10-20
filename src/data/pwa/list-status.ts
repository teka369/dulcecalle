/**
 * B3: how a list screen may render after a read. A failed read (5xx,
 * timeout, network) never renders as "no data": with local rows it shows
 * them plus a band; without them it shows an error + Reintentar.
 */
export type ListReadStatus = {
  /** server = fresh; cache = this device's copy after a failed read. */
  source: "server" | "cache" | null;
  cachedAt: number | null;
  /** Last read failed and nothing (or only stale memory) could be shown. */
  error: string | null;
};

export const EMPTY_LIST_STATUS: ListReadStatus = { source: null, cachedAt: null, error: null };

export type ListGate = "loading" | "error" | "empty" | "list";

export function listGate(input: { loading: boolean; count: number; status: ListReadStatus }): ListGate {
  if (input.count > 0) return "list";
  if (input.status.error) return "error";
  if (input.loading || input.status.source == null) return "loading";
  return "empty";
}

export type HeroFigures = "value" | "skeleton" | "error";

/**
 * Hero money/count figures. While nothing real is known (no server answer,
 * no local rows) they are a skeleton — never a fake "$0" / "0 productos".
 */
export function heroFigures(gate: ListGate): HeroFigures {
  if (gate === "loading") return "skeleton";
  if (gate === "error") return "error";
  return "value";
}

export type ListBand = { capturedAt: number } | { text: string } | null;

export const LIST_STALE_TEXT = "No se pudo actualizar · mostrando datos de este teléfono";

/** Hero band for a list: offline → capture time; online but read failed → "No se pudo actualizar". */
export function listBand(status: ListReadStatus, online: boolean, count: number): ListBand {
  const stale = status.source === "cache" || (status.error != null && count > 0);
  if (!stale) return null;
  if (!online && status.cachedAt != null) return { capturedAt: status.cachedAt };
  return { text: online ? LIST_STALE_TEXT : "Sin conexión · datos de este teléfono" };
}

export function listErrorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "No se pudo cargar.";
}
