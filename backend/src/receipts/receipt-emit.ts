import { randomInt, randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { contentHash } from "../shared/canonical";

/**
 * C09-PR2 — receipts are written in the SAME transaction as their source
 * (I-C1) and never updated (DB trigger `receipts_insert_only`).
 */
export type ReceiptKind = "sale" | "payment" | "allocation" | "reversal" | "adjustment" | "return";
export type ReceiptSource = "sale" | "customer_payment" | "sale_return";
export type ReceiptRef = { id: string; kind: ReceiptKind; number: string; verifyCode: string };

/** §3.2 — base32 without ambiguous characters (no 0/1/O/I/L/U). */
export const VERIFY_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newVerifyCode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += VERIFY_ALPHABET[randomInt(VERIFY_ALPHABET.length)];
  return s;
}

export async function emitReceipt(
  tx: Prisma.TransactionClient,
  args: {
    businessId: string;
    customerId: string | null;
    kind: ReceiptKind;
    sourceType: ReceiptSource;
    sourceId: string;
    number: string;
    snapshot: Record<string, unknown>;
    createdAt: Date;
    prevReceiptId?: string | null;
  },
): Promise<ReceiptRef> {
  // Random, never derived from ids; a clash (≈30^-10) is re-drawn before the
  // insert so the transaction is not aborted by the unique index.
  let verifyCode = newVerifyCode();
  for (let i = 0; i < 5 && (await tx.receipt.findUnique({ where: { verifyCode }, select: { id: true } })); i++) {
    verifyCode = newVerifyCode();
  }
  const id = randomUUID();
  await tx.receipt.create({
    data: {
      id,
      businessId: args.businessId,
      customerId: args.customerId,
      kind: args.kind,
      sourceType: args.sourceType,
      sourceId: args.sourceId,
      number: args.number,
      verifyCode,
      snapshot: args.snapshot as Prisma.InputJsonValue,
      contentHash: contentHash(args.snapshot),
      prevReceiptId: args.prevReceiptId ?? null,
      createdAt: args.createdAt,
    },
  });
  return { id, kind: args.kind, number: args.number, verifyCode };
}

/** `receipts: [{id, kind, number, verifyCode}]` of a source, for create/replay responses (§7). */
export async function receiptRefs(
  db: Pick<PrismaClient, "receipt"> | Prisma.TransactionClient,
  businessId: string,
  sourceId: string,
): Promise<ReceiptRef[]> {
  const rows = await db.receipt.findMany({
    where: { businessId, sourceId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, kind: true, number: true, verifyCode: true },
  });
  return rows.map((r) => ({ id: r.id, kind: r.kind as ReceiptKind, number: r.number, verifyCode: r.verifyCode }));
}
