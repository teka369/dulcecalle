/**
 * Canonical snapshot encoding for SHA-256 checksums.
 *
 * Semantics (JSON-compatible, so memory → stringify → parse is stable):
 * - object keys: sorted
 * - object properties whose value is `undefined`: omitted
 * - `null`: kept as null (distinct from omitted/undefined)
 * - array order: preserved (Dexie `toArray()` order is data)
 * - array `undefined` / holes: encoded as `null` (JSON.stringify)
 * - numbers / strings / booleans: JSON values (`NaN`/`Infinity` → null)
 * - Date: ISO string (JSON.stringify)
 * - functions / symbols: omitted
 */

export function canonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => {
      const inner = canonicalize(item);
      return inner === undefined ? null : inner;
    });
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      const inner = canonicalize((value as Record<string, unknown>)[key]);
      if (inner === undefined) continue;
      out[key] = inner;
    }
    return out;
  }
  return undefined;
}

export function stableStringify(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) return "null";
  return JSON.stringify(canonical);
}

export async function hashUtf8(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("SHA-256 is not available in this environment");
  }
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function checksumCanonical(value: unknown): Promise<string> {
  return hashUtf8(stableStringify(value));
}
