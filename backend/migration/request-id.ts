import { createHash } from "crypto";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Namespace for deterministic v5 of Dexie fallback requestIds. */
export const DULCECALLE_REQUEST_NS = "6ba7b811-9dad-11d1-80b4-d05ec41e0001";

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

export function uuidv5(name: string, namespace: string): string {
  const hash = createHash("sha1")
    .update(uuidToBytes(namespace))
    .update(name)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

export function mapRequestId(raw?: string): {
  requestId: string | null;
  legacyRequestId: string | null;
} {
  if (!raw) return { requestId: null, legacyRequestId: null };
  if (UUID_RE.test(raw)) {
    return { requestId: raw.toLowerCase(), legacyRequestId: null };
  }
  return {
    requestId: uuidv5(raw, DULCECALLE_REQUEST_NS),
    legacyRequestId: raw,
  };
}
