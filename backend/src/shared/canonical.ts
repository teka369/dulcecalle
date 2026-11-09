import { createHash } from "crypto";

/**
 * C09 §3.2 — canonical form of a receipt snapshot: keys sorted (recursive),
 * no whitespace, money as integer COP strings, dates as ISO with the
 * business zone. The hash is sha256(canonical) in hex (I-C2). Snapshots are
 * built only from strings, integers, booleans, null, arrays and objects, so
 * the canonical text survives a jsonb round trip (key order is re-sorted).
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) throw new Error("canonicalJson: only safe integers");
      return JSON.stringify(value);
    case "object": {
      const o = value as Record<string, unknown>;
      return `{${Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
        .join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof value}`);
  }
}

export function contentHash(snapshot: unknown): string {
  return createHash("sha256").update(canonicalJson(snapshot), "utf8").digest("hex");
}

/** Integer COP as a string («montos como enteros COP en string»). */
export function copString(n: bigint): string {
  return n.toString();
}

/** 2026-11-09T05:43:00.123-05:00 — the instant written in `timeZone` (default America/Bogota). */
export function isoInZone(d: Date, timeZone = "America/Bogota"): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const ms = d.getUTCMilliseconds();
  const local = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!, ms);
  const offset = Math.round((local - d.getTime()) / 60000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${pad(ms, 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}
