/**
 * C09-PR1 (SPEC-C09 §3.1, T3) — the reference a seller sees for a sale:
 * while it is only on this phone, the local `L-AAMMDD-XXXX` ref; once the
 * server accepted it, its per-business number (`DC-000125`).
 */
export function saleReference(s: { pending?: boolean; localRef?: string; number?: string | null }): string | null {
  if (s.pending && s.localRef) return `Ref. local ${s.localRef}`;
  if (s.number) return s.number;
  return null;
}
