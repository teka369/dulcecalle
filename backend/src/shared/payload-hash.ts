import { createHash } from "crypto";
import { AppError, ERROR_CODES } from "./errors";

/**
 * C02 / DC-13 — an Idempotency-Key is bound to the payload it was first used
 * with. Fields are listed explicitly (stable order) so the hash does not depend
 * on JSON key order. Device time (`occurredAt`) is excluded on purpose: a retry
 * of the same op may carry a fresh timestamp.
 */
export function payloadHash(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).sort();
  const canonical = JSON.stringify(keys.map((k) => [k, fields[k] ?? null]));
  return createHash("sha256").update(canonical).digest("hex");
}

export const IDEMPOTENCY_MISMATCH_MESSAGE =
  "Esta operación ya se registró con otros datos. Revisa e inténtalo como una operación nueva.";

/** Replay with a stored hash that differs → 422; null stored hash (legacy row) → caller decides. */
export function assertSamePayload(stored: string | null | undefined, incoming: string): void {
  if (stored != null && stored !== incoming) {
    throw new AppError(ERROR_CODES.IDEMPOTENCY_MISMATCH, IDEMPOTENCY_MISMATCH_MESSAGE);
  }
}
