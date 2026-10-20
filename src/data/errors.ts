/** Contractual API error. Preserve `code` — do not hide as "Algo salió mal". */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Transport failure. Not an auth decision — do not clear the session. */
export class NetworkError extends Error {
  readonly code = "NETWORK";
  readonly cause?: unknown;
  constructor(message = "Sin conexión.", cause?: unknown) {
    super(message);
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export const API_ERROR_CODES = {
  VALIDATION: "VALIDATION",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CLOSED_DAY: "CLOSED_DAY",
  SESSION_ALREADY_CLOSED: "SESSION_ALREADY_CLOSED",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  ABONO_EXCEEDS_DEBT: "ABONO_EXCEEDS_DEBT",
  NEED_COST: "NEED_COST",
  STOCK_VIA_MOVES: "STOCK_VIA_MOVES",
  RATE_LIMIT: "RATE_LIMIT",
  INTERNAL: "INTERNAL",
  NETWORK: "NETWORK",
} as const;

export function isNetworkError(e: unknown): boolean {
  if (e instanceof NetworkError) return true;
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    return e.name === "AbortError" || e.name === "TimeoutError";
  }
  if (e instanceof TypeError) return true;
  if (e instanceof Error) {
    return /failed to fetch|networkerror|load failed|network request failed|aborted|timeout/i.test(
      e.message,
    );
  }
  return false;
}

export function toNetworkError(e: unknown): NetworkError {
  if (e instanceof NetworkError) return e;
  return new NetworkError("Sin conexión.", e);
}

export function apiErrorFromBody(
  status: number,
  body: unknown,
): ApiError {
  const envelope =
    body && typeof body === "object" && "error" in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  const code =
    envelope && typeof envelope.code === "string" && envelope.code
      ? envelope.code
      : status === 401
        ? API_ERROR_CODES.UNAUTHORIZED
        : status === 403
          ? API_ERROR_CODES.FORBIDDEN
          : status === 404
            ? API_ERROR_CODES.NOT_FOUND
            : status === 409
              ? API_ERROR_CODES.INTERNAL
              : status === 400
                ? API_ERROR_CODES.VALIDATION
                : API_ERROR_CODES.INTERNAL;
  const message =
    envelope && typeof envelope.message === "string" && envelope.message
      ? envelope.message
      : "Algo salió mal.";
  return new ApiError(code, message, status);
}
