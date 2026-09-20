/**
 * Local peek of JWT `exp` only. Does not verify the signature.
 * The backend remains the authority for token validity.
 */

function utf8FromBinary(binary: string): string {
  if (typeof TextDecoder === "function") {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i) & 0xff;
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
  return binary;
}

function decodeBase64Url(segment: string): string | null {
  if (!segment) return null;
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    const atobFn = (globalThis as { atob?: (value: string) => string }).atob;
    if (typeof atobFn === "function") {
      return utf8FromBinary(atobFn(padded));
    }
  } catch {
    /* try Buffer below — atob is missing or rejected the segment */
  }
  try {
    const Buf = (
      globalThis as {
        Buffer?: {
          from(data: string, enc: string): { toString(enc: string): string };
        };
      }
    ).Buffer;
    if (Buf) return Buf.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
  return null;
}

/** Unix seconds, or null when the token is not a JWT with numeric `exp`. */
export function readJwtExpSeconds(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const raw = decodeBase64Url(parts[1] ?? "");
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const exp = (parsed as { exp?: unknown }).exp;
    if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
    return exp;
  } catch {
    return null;
  }
}

/**
 * True only when `exp` is a finite number already in the past.
 * Unparseable tokens and payloads without numeric `exp` return false
 * (caller keeps the previous presence-based behaviour).
 *
 * `exp` is JWT NumericDate: seconds since epoch, not milliseconds.
 */
export function jwtExpIsPast(token: string, nowMs: number = Date.now()): boolean {
  const exp = readJwtExpSeconds(token);
  if (exp == null) return false;
  return exp * 1000 <= nowMs;
}
