import type { Prisma, PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "reversal"> | Pick<Prisma.TransactionClient, "reversal">;

/** C07 §3.3 — derived «anulado» state exposed by sales, payments and ledgers. */
export type ReversalRef = {
  id: string;
  number: string;
  reasonCode: string;
  reasonText: string | null;
  createdAt: Date;
};

export async function reversalsByTarget(
  db: Db,
  businessId: string,
  targetType: "sale" | "customer_payment",
  ids: string[],
): Promise<Map<string, ReversalRef>> {
  if (ids.length === 0) return new Map();
  const rows = await (db.reversal as PrismaClient["reversal"]).findMany({
    where: { businessId, targetType, targetId: { in: ids } },
    select: { id: true, number: true, reasonCode: true, reasonText: true, createdAt: true, targetId: true },
  });
  return new Map(
    rows.map((r) => [
      r.targetId,
      { id: r.id, number: r.number, reasonCode: r.reasonCode, reasonText: r.reasonText, createdAt: r.createdAt },
    ]),
  );
}
