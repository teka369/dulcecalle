import { AppError, ERROR_CODES } from "./errors";

/** Max clock skew accepted for a device timestamp in the future. */
const OCCURRED_AT_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Decision 16: X-Offline-Replay may accept a past occurredAt up to 30 days back. */
const OCCURRED_AT_MAX_PAST_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * C01/C03 — device occurrence time; never in the future, at most 30 days back.
 * Defaults to `now` when the client omitted it (online compatibility).
 *
 * Decision 16: `X-Offline-Replay` only authorizes a past / closed-day
 * `occurredAt` within this 30-day window; it never skips other validations.
 * C03 does not require the header for an other-day `occurredAt` — C01 already
 * accepts that case and must not regress.
 */
export function parseOccurredAt(raw: string | undefined, now: Date): Date {
  if (raw == null) return now;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    throw new AppError(ERROR_CODES.VALIDATION, "La fecha de la operación no es válida.");
  }
  if (at.getTime() > now.getTime() + OCCURRED_AT_FUTURE_SKEW_MS) {
    throw new AppError(ERROR_CODES.VALIDATION, "La fecha de la operación está en el futuro.");
  }
  if (now.getTime() - at.getTime() > OCCURRED_AT_MAX_PAST_MS) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      "La fecha de la operación no puede ser de hace más de 30 días.",
    );
  }
  return at;
}

/** True when the request is an offline replay (Decision 16). Informational for C03. */
export function isOfflineReplay(header?: string): boolean {
  if (header == null || header.trim() === "") return false;
  const value = header.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
