import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * C09-PR4 — derived confirmation state of a receipt (§7 `ackState`): the
 * latest confirmation wins; none → pending. Confirmations are evidence
 * only: nothing here changes balances (I-C5).
 */
export type AckState = "pending" | "acknowledged" | "reported";

type Db = Pick<PrismaClient, "receipt" | "receiptAcknowledgement"> | Prisma.TransactionClient;

export async function ackStates(db: Db, businessId: string, receiptIds: string[]): Promise<Map<string, AckState>> {
  const out = new Map<string, AckState>(receiptIds.map((id) => [id, "pending"]));
  if (receiptIds.length === 0) return out;
  const rows = await db.receiptAcknowledgement.findMany({
    where: { businessId, receiptId: { in: receiptIds } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { receiptId: true, kind: true },
  });
  for (const r of rows) out.set(r.receiptId, r.kind === "acknowledged" ? "acknowledged" : "reported");
  return out;
}

export type LedgerReceiptRef = { receiptId: string; number: string; ackState: AckState };

/** §7 — `receiptId`, `number`, `ackState` per ledger movement (sale, payment, return). */
export async function ledgerReceiptRefs(db: Db, businessId: string, sourceIds: string[]): Promise<Map<string, LedgerReceiptRef>> {
  if (sourceIds.length === 0) return new Map();
  const receipts = await db.receipt.findMany({
    where: { businessId, sourceId: { in: sourceIds }, kind: { in: ["sale", "payment", "return"] } },
    select: { id: true, sourceId: true, number: true },
  });
  const states = await ackStates(db, businessId, receipts.map((r) => r.id));
  return new Map(receipts.map((r) => [r.sourceId, { receiptId: r.id, number: r.number, ackState: states.get(r.id)! }]));
}
