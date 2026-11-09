import type { Prisma } from "@prisma/client";

/**
 * C09 §3.1 — per-business human numbers (decisions 5, 13, 26). One row per
 * (business, kind) in `business_sequences`; `next` is the number the next
 * row gets. Always called inside the transaction that creates the row: the
 * upsert takes the row lock, so concurrent creators serialize, and a rollback
 * undoes the bump (no gaps, I-C6). Never reset (a business wipe keeps them).
 */
export type SequenceKind = "sale" | "payment" | "reversal" | "adjustment" | "return";

const PREFIX: Record<SequenceKind, string> = {
  sale: "DC-",
  payment: "DC-P-",
  reversal: "DC-R-",
  adjustment: "DC-A-",
  return: "DC-D-",
};

export async function nextNumber(tx: Prisma.TransactionClient, businessId: string, kind: SequenceKind): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
    INSERT INTO business_sequences (business_id, kind, next, updated_at)
    VALUES (${businessId}::uuid, ${kind}::"SequenceKind", 2, NOW())
    ON CONFLICT (business_id, kind) DO UPDATE SET next = business_sequences.next + 1, updated_at = NOW()
    RETURNING next - 1 AS n
  `;
  return Number(rows[0]!.n);
}

/** DC-000125 / DC-P-000045 / DC-R-000001 … (6 digits, more if it ever grows). */
export function formatNumber(kind: SequenceKind, n: number | null | undefined): string | null {
  if (n == null) return null;
  return `${PREFIX[kind]}${String(n).padStart(6, "0")}`;
}
