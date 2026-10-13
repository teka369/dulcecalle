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

/**
 * Deterministic child requestId (UUID v5-style, SHA-1 of parent + purpose).
 * Same parent + purpose → same id, so a retried composite intent (e.g. surtir
 * with an inline new supplier) reuses its child's Idempotency-Key.
 */
export async function deriveRequestId(parent: string, purpose: string): Promise<string> {
  if (!UUID_RE.test(parent)) throw new Error("deriveRequestId: parent must be a UUID.");
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("crypto.subtle is required to derive a requestId.");
  }
  const data = new TextEncoder().encode(`${parent.toLowerCase()}::${purpose}`);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-1", data)).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
