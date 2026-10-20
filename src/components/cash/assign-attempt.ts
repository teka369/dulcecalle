import { newEntityId } from "@/data/local/ids";

/** One «Asignar a esa caja» intent: the same move into the same caja. */
export type AssignAttempt = { moveId: string; target: string; requestId: string };

/**
 * Retrying the same intent (same move → same caja) reuses its requestId so the
 * server's Idempotency-Key dedupes it; a different move or caja is a new intent.
 */
export function assignAttemptFor(
  prev: AssignAttempt | null,
  moveId: string,
  target: string,
  mint: () => string = newEntityId,
): AssignAttempt {
  if (prev && prev.moveId === moveId && prev.target === target) return prev;
  return { moveId, target, requestId: mint() };
}

export const ASSIGN_ERROR_FALLBACK = "No se pudo asignar el movimiento. Intenta de nuevo.";

export function assignErrorMessage(e: unknown): string {
  const detail = e instanceof Error && e.message.trim() ? e.message.trim() : "";
  return detail && detail !== "Algo salió mal." ? `No se pudo asignar: ${detail}` : ASSIGN_ERROR_FALLBACK;
}
