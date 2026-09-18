import { AppError, ERROR_CODES } from "./errors";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireIdempotencyKey(header?: string): string {
  const v = header?.trim() ?? "";
  if (!v || !UUID_RE.test(v)) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      "Idempotency-Key is required (UUID).",
    );
  }
  return v;
}

/** Header wins. Body requestId, if sent, must equal the header. */
export function resolveIdempotencyKey(
  header?: string,
  bodyRequestId?: string,
): string {
  const key = requireIdempotencyKey(header);
  if (bodyRequestId != null && bodyRequestId !== key) {
    throw new AppError(
      ERROR_CODES.VALIDATION,
      "Idempotency-Key must match requestId.",
    );
  }
  return key;
}
