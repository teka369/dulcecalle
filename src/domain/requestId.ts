/** UUID v4. Used as Idempotency-Key and as M6 local entity PK. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mint a UUID. No `prefix-Date.now-random` fallback — the API rejects that
 * as Idempotency-Key. Same intent must reuse the returned value; never mint
 * again on retry.
 *
 * `_intent` is kept so existing `newRequestId("surtir")` call sites compile.
 * It is not embedded in the id.
 */
export function newRequestId(_intent?: string): string {
  void _intent;
  return newStableUuid();
}

/** Client-minted PK for M6 local entities. Same generator as requestId. */
export function newEntityId(): string {
  return newStableUuid();
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function newStableUuid(): string {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is required to mint a UUID.");
  }
  const id = crypto.randomUUID();
  if (!UUID_RE.test(id)) {
    throw new Error("crypto.randomUUID returned a non-UUID value.");
  }
  return id;
}
