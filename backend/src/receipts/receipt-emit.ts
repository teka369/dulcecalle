import { randomInt, randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { contentHash, copString, isoInZone } from "../shared/canonical";
import { loadObligations } from "../shared/debt-allocations";
import { formatNumber } from "../shared/sequences";

/**
 * C09-PR2 — receipts are written in the SAME transaction as their source
 * (I-C1) and never updated (DB trigger `receipts_insert_only`).
 */
export type ReceiptKind = "sale" | "payment" | "allocation" | "reversal" | "adjustment" | "return";
export type ReceiptSource = "sale" | "customer_payment" | "sale_return" | "allocation" | "reversal";
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
    // The parent sorts before its annex: "DC-P-000001" < "DC-P-000001/D1".
    orderBy: [{ createdAt: "asc" }, { number: "asc" }],
    select: { id: true, kind: true, number: true, verifyCode: true },
  });
  return rows.map((r) => ({ id: r.id, kind: r.kind as ReceiptKind, number: r.number, verifyCode: r.verifyCode }));
}

export type AllocationLineSnap = {
  targetType: "sale" | "initial_debt" | "credit";
  saleId: string | null;
  saleNumber: string | null;
  initialDebtId: string | null;
  amount: string;
  openBefore: string | null;
  openAfter: string | null;
};

/**
 * C09-PR3 — the distribution of one `debt_allocations` group (SPEC §2): per
 * obligation the amount and its open balance before/after. Read right after
 * the group's rows are written (open after = current open; before = after +
 * what this group applied). Rows are signed, so a reversal release shows a
 * negative amount and a higher open balance after.
 */
export async function collectAllocation(
  tx: Prisma.TransactionClient,
  businessId: string,
  customerId: string,
  groupId: string,
): Promise<AllocationLineSnap[]> {
  const rows = await tx.debtAllocation.findMany({
    where: { businessId, customerId, groupId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) return [];
  const order: string[] = [];
  const sums = new Map<string, { targetType: AllocationLineSnap["targetType"]; id: string | null; amount: bigint }>();
  for (const r of rows) {
    const id = r.targetType === "sale" ? r.saleId : r.targetType === "initial_debt" ? r.initialDebtId : null;
    const key = `${r.targetType}:${id ?? ""}`;
    const cur = sums.get(key);
    if (cur) cur.amount += r.amount;
    else {
      order.push(key);
      sums.set(key, { targetType: r.targetType, id, amount: r.amount });
    }
  }
  const open = new Map((await loadObligations(tx, businessId, customerId)).map((o) => [`${o.kind}:${o.id}`, o.open]));
  const saleIds = [...sums.values()].filter((x) => x.targetType === "sale").map((x) => x.id!);
  const numbers = new Map(
    (await tx.sale.findMany({ where: { businessId, id: { in: saleIds } }, select: { id: true, number: true } })).map((x) => [
      x.id,
      formatNumber("sale", x.number),
    ]),
  );
  // Obligations in written order, then the saldo a favor line (deterministic).
  order.sort((x, y) => Number(x.startsWith("credit:")) - Number(y.startsWith("credit:")));
  return order.map((key) => {
    const x = sums.get(key)!;
    if (x.targetType === "credit") {
      return { targetType: "credit", saleId: null, saleNumber: null, initialDebtId: null, amount: copString(x.amount), openBefore: null, openAfter: null };
    }
    const after = open.get(key) ?? 0n;
    return {
      targetType: x.targetType,
      saleId: x.targetType === "sale" ? x.id : null,
      saleNumber: x.targetType === "sale" ? (numbers.get(x.id!) ?? null) : null,
      initialDebtId: x.targetType === "initial_debt" ? x.id : null,
      amount: copString(x.amount),
      openBefore: copString(after + x.amount),
      openAfter: copString(after),
    };
  });
}

/**
 * C09-PR3 — `allocation` receipt: annex of the receipt that caused the
 * distribution (abono, credit_apply in a sale, return, reversal), numbered
 * `<parent>/D<n>` (WIRES J7). No receipt when the group wrote no rows.
 */
export async function emitAllocationReceipt(
  tx: Prisma.TransactionClient,
  args: {
    businessId: string;
    customerId: string;
    groupId: string;
    parent: ReceiptRef;
    createdAt: Date;
    timeZone: string;
    occurredOn: string;
    adjusted?: boolean;
    lines?: AllocationLineSnap[];
  },
): Promise<ReceiptRef | null> {
  const lines = args.lines ?? (await collectAllocation(tx, args.businessId, args.customerId, args.groupId));
  if (lines.length === 0) return null;
  const n =
    1 +
    (await tx.receipt.count({
      where: { businessId: args.businessId, kind: "allocation", number: { startsWith: `${args.parent.number}/D` } },
    }));
  const number = `${args.parent.number}/D${n}`;
  const [business, customer] = await Promise.all([
    tx.business.findUniqueOrThrow({ where: { id: args.businessId }, select: { id: true, name: true } }),
    tx.customer.findFirstOrThrow({ where: { id: args.customerId, businessId: args.businessId }, select: { id: true, code: true, name: true } }),
  ]);
  let toObligations = 0n;
  let toCredit = 0n;
  let creditUsed = 0n;
  for (const l of lines) {
    const a = BigInt(l.amount);
    if (l.targetType !== "credit") toObligations += a;
    else if (a > 0n) toCredit += a;
    else creditUsed -= a;
  }
  return emitReceipt(tx, {
    businessId: args.businessId,
    customerId: args.customerId,
    kind: "allocation",
    sourceType: "allocation",
    sourceId: args.groupId,
    number,
    createdAt: args.createdAt,
    snapshot: {
      kind: "allocation",
      number,
      business: { id: business.id, name: business.name },
      createdAt: isoInZone(args.createdAt, args.timeZone),
      occurredOn: args.occurredOn,
      customer: { id: customer.id, code: customer.code, name: customer.name },
      internal: false,
      parent: { receiptId: args.parent.id, kind: args.parent.kind, number: args.parent.number },
      adjusted: args.adjusted ?? false,
      lines,
      toObligations: copString(toObligations),
      toCredit: copString(toCredit),
      creditUsed: copString(creditUsed),
    },
  });
}
