import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * C09 — derived confirmation state of a receipt (§7 `ackState`), ONE
 * derivation for every reader (owner receipts list/detail, portal
 * list/detail, owner and portal ledger).
 *
 * Juan's rule (P-C09-14, PR4.1): a dispute stays in reconciliation. An open
 * «Hay un error» (reported_issue) keeps the state `reported` even if a later
 * «Reconozco esto» arrives; both rows stay (insert-only). A report closes
 * only when it is resolved (owner or C08). There is no resolution mechanism
 * yet, so `resolvedReportIds` is empty today and every report stays open;
 * a future resolution row / claim status only has to feed that set.
 * Confirmations are evidence only: nothing here changes balances (I-C5).
 */
export type AckState = "pending" | "acknowledged" | "reported";

type Db = Pick<PrismaClient, "receipt" | "receiptAcknowledgement"> | Prisma.TransactionClient;

export type AckRow = { id: string; kind: "acknowledged" | "reported_issue" };

export function deriveAckState(acks: AckRow[], resolvedReportIds: ReadonlySet<string> = new Set()): AckState {
  if (acks.some((a) => a.kind === "reported_issue" && !resolvedReportIds.has(a.id))) return "reported";
  if (acks.some((a) => a.kind === "acknowledged")) return "acknowledged";
  return "pending";
}

/** Report ids already resolved. None until the owner / C08 resolution exists. */
async function resolvedReports(_db: Db, _businessId: string, _reportIds: string[]): Promise<Set<string>> {
  return new Set();
}

export async function ackStates(db: Db, businessId: string, receiptIds: string[]): Promise<Map<string, AckState>> {
  const out = new Map<string, AckState>(receiptIds.map((id) => [id, "pending"]));
  if (receiptIds.length === 0) return out;
  const rows = await db.receiptAcknowledgement.findMany({
    where: { businessId, receiptId: { in: receiptIds } },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { id: true, receiptId: true, kind: true },
  });
  const resolved = await resolvedReports(db, businessId, rows.filter((r) => r.kind === "reported_issue").map((r) => r.id));
  const byReceipt = new Map<string, AckRow[]>();
  for (const r of rows) byReceipt.set(r.receiptId, [...(byReceipt.get(r.receiptId) ?? []), r]);
  for (const [id, acks] of byReceipt) out.set(id, deriveAckState(acks, resolved));
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
